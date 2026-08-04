from __future__ import annotations

import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.models import AdminAuditEvent, BuildJob, Project, Purchase, Subscription, User, utcnow
from app.routers import admin as admin_router
from app.routers import auth as auth_router
from app.security import create_token, hash_password, read_token, verify_password
from app.services.bootstrap import ensure_temp_admin_account


class AdminApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)
        db = self.Session()
        self.admin = User(
            email="owner@apex.test",
            password_hash=hash_password("correct horse battery staple"),
            display_name="Owner",
            company_name="Apex Files",
            role="admin",
            selected_package="pro",
        )
        self.user = User(
            email="customer@example.test",
            password_hash=hash_password("customer-password"),
            display_name="Customer",
            company_name="<script>alert(1)</script>",
            role="tuner",
            selected_package="free",
        )
        db.add_all([self.admin, self.user])
        db.flush()
        db.add_all(
            [
                Subscription(
                    user_id=self.admin.id,
                    plan_name="Apex Pro",
                    monthly_file_limit=9999,
                    period_ends_at=utcnow() + timedelta(days=30),
                ),
                Subscription(
                    user_id=self.user.id,
                    plan_name="Apex Free",
                    monthly_file_limit=1,
                    period_ends_at=utcnow() + timedelta(days=30),
                ),
            ]
        )
        db.commit()
        db.close()

        app = FastAPI()
        app.include_router(auth_router.router, prefix="/api")
        app.include_router(admin_router.router, prefix="/api")

        def override_db():
            session = self.Session()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)
        self.admin_token = create_token(
            self.admin.id,
            session_version=self.admin.session_version,
            audience="admin",
        )
        self.admin_headers = {"Authorization": f"Bearer {self.admin_token}"}
        with admin_router._admin_login_lock:
            admin_router._admin_login_failures.clear()

    def tearDown(self):
        self.client.close()
        self.engine.dispose()

    def test_admin_boundary_requires_admin_audience_role_and_origin(self):
        app_token = create_token(self.admin.id, session_version=0, audience="app")
        response = self.client.get(
            "/api/admin/overview",
            headers={"Authorization": f"Bearer {app_token}"},
        )
        self.assertEqual(response.status_code, 401)

        tuner_admin_token = create_token(self.user.id, session_version=0, audience="admin")
        response = self.client.get(
            "/api/admin/overview",
            headers={"Authorization": f"Bearer {tuner_admin_token}"},
        )
        self.assertEqual(response.status_code, 403)

        response = self.client.get(
            "/api/admin/overview",
            headers={**self.admin_headers, "Origin": "https://customer.invalid"},
        )
        self.assertEqual(response.status_code, 403)

        response = self.client.get(
            "/api/admin/overview",
            headers={**self.admin_headers, "Origin": "http://localhost:5173"},
        )
        self.assertEqual(response.status_code, 200)

    def test_admin_login_is_separate_short_lived_and_admin_only(self):
        response = self.client.post(
            "/api/admin/auth/login",
            json={"email": self.user.email, "password": "customer-password"},
        )
        self.assertEqual(response.status_code, 401)

        response = self.client.post(
            "/api/admin/auth/login",
            json={"email": self.admin.email, "password": "correct horse battery staple"},
        )
        self.assertEqual(response.status_code, 200)
        payload = read_token(response.json()["token"])
        self.assertEqual(payload["aud"], "admin")
        self.assertLessEqual(payload["exp"] - payload["iat"], 8 * 60 * 60)

    def test_admin_login_rate_limit_blocks_repeated_failures(self):
        for _ in range(5):
            response = self.client.post(
                "/api/admin/auth/login",
                json={"email": "unknown@example.com", "password": "wrong"},
            )
            self.assertEqual(response.status_code, 401)
        response = self.client.post(
            "/api/admin/auth/login",
            json={"email": "unknown@example.com", "password": "wrong"},
        )
        self.assertEqual(response.status_code, 429)

    def test_public_registration_cannot_self_assign_paid_plan_and_disabled_login_is_blocked(self):
        response = self.client.post(
            "/api/auth/register",
            json={
                "email": "new@example.com",
                "password": "long-enough-password",
                "package_key": "pro",
            },
        )
        self.assertEqual(response.status_code, 200)
        user_id = response.json()["user"]["id"]
        with self.Session() as db:
            created = db.get(User, user_id)
            subscription = db.scalar(select(Subscription).where(Subscription.user_id == user_id))
            self.assertEqual(created.selected_package, "free")
            self.assertEqual(subscription.plan_name, "Apex Free")
            self.assertEqual(subscription.monthly_file_limit, 1)

            customer = db.get(User, self.user.id)
            customer.is_active = False
            db.commit()

        response = self.client.post(
            "/api/auth/login",
            json={"email": self.user.email, "password": "customer-password"},
        )
        self.assertEqual(response.status_code, 403)

    def test_disable_and_password_reset_revoke_existing_sessions(self):
        old_app_token = create_token(self.user.id, session_version=0, audience="app")
        app_headers = {"Authorization": f"Bearer {old_app_token}"}
        self.assertEqual(self.client.get("/api/auth/me", headers=app_headers).status_code, 200)

        response = self.client.patch(
            f"/api/admin/users/{self.user.id}/status",
            headers=self.admin_headers,
            json={"is_active": False},
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["is_active"])
        self.assertEqual(self.client.get("/api/auth/me", headers=app_headers).status_code, 401)

        response = self.client.patch(
            f"/api/admin/users/{self.user.id}/status",
            headers=self.admin_headers,
            json={"is_active": True},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me", headers=app_headers).status_code, 401)

        new_login = self.client.post(
            "/api/auth/login",
            json={"email": self.user.email, "password": "customer-password"},
        )
        self.assertEqual(new_login.status_code, 200)
        current_token = new_login.json()["token"]

        response = self.client.post(
            f"/api/admin/users/{self.user.id}/password-reset",
            headers=self.admin_headers,
            json={},
        )
        self.assertEqual(response.status_code, 200)
        temporary_password = response.json()["temporary_password"]
        self.assertGreaterEqual(len(temporary_password), 10)
        self.assertEqual(
            self.client.get(
                "/api/auth/me",
                headers={"Authorization": f"Bearer {current_token}"},
            ).status_code,
            401,
        )
        self.assertEqual(
            self.client.post(
                "/api/auth/login",
                json={"email": self.user.email, "password": temporary_password},
            ).status_code,
            200,
        )
        with self.Session() as db:
            actions = set(db.scalars(select(AdminAuditEvent.action)).all())
            self.assertTrue({"user.disabled", "user.enabled", "user.password_reset"}.issubset(actions))

    def test_user_subscription_lists_and_sensitive_fields_are_not_exposed(self):
        response = self.client.get(
            "/api/admin/users",
            params={"search": "customer", "plan": "free", "status": "active"},
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 1)
        serialized = response.text
        self.assertNotIn("password_hash", serialized)
        self.assertNotIn("source_path", serialized)
        self.assertNotIn("revtech_payload", serialized)

        with self.Session() as db:
            subscription = db.scalar(select(Subscription).where(Subscription.user_id == self.user.id))
            subscription.files_used_this_period = 3
            db.commit()

        rejected_usage_update = self.client.patch(
            f"/api/admin/users/{self.user.id}/subscription",
            headers=self.admin_headers,
            json={"package_key": "lite", "files_used_this_period": 7},
        )
        self.assertEqual(rejected_usage_update.status_code, 422)

        response = self.client.patch(
            f"/api/admin/users/{self.user.id}/subscription",
            headers=self.admin_headers,
            json={"package_key": "lite"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["plan_name"], "Apex Lite")
        self.assertEqual(response.json()["monthly_file_limit"], 20)
        self.assertEqual(response.json()["files_used_this_period"], 3)

        response = self.client.get(
            "/api/admin/subscriptions",
            params={"search": "customer", "plan": "lite"},
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 1)
        self.assertEqual(response.json()["items"][0]["files_used_this_period"], 3)

    def test_profile_update_validates_fields_unique_email_and_records_audit(self):
        response = self.client.patch(
            f"/api/admin/users/{self.user.id}",
            headers=self.admin_headers,
            json={
                "email": "RENAMED@Example.com",
                "display_name": "  Renamed Customer  ",
                "company_name": "  Updated Company  ",
                "vat_number": "  SE999999999  ",
                "phone_number": "  +46 70 123 45 67  ",
                "country": "  Sweden  ",
                "role": "admin",
            },
        )
        self.assertEqual(response.status_code, 200)
        updated = response.json()
        self.assertEqual(updated["email"], "renamed@example.com")
        self.assertEqual(updated["display_name"], "Renamed Customer")
        self.assertEqual(updated["company_name"], "Updated Company")
        self.assertEqual(updated["vat_number"], "SE999999999")
        self.assertEqual(updated["phone_number"], "+46 70 123 45 67")
        self.assertEqual(updated["country"], "Sweden")
        self.assertEqual(updated["role"], "admin")

        with self.Session() as db:
            collision = User(
                email="collision@example.com",
                password_hash=hash_password("collision-password"),
            )
            db.add(collision)
            db.commit()

        duplicate = self.client.patch(
            f"/api/admin/users/{self.user.id}",
            headers=self.admin_headers,
            json={"email": "COLLISION@example.com"},
        )
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(
            self.client.patch(
                f"/api/admin/users/{self.user.id}",
                headers=self.admin_headers,
                json={"email": "not-an-email"},
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.patch(
                f"/api/admin/users/{self.user.id}",
                headers=self.admin_headers,
                json={"role": "owner"},
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.patch(
                f"/api/admin/users/{self.user.id}",
                headers=self.admin_headers,
                json={"password_hash": "must-not-be-writable"},
            ).status_code,
            422,
        )

        with patch.object(
            self.Session.class_,
            "commit",
            side_effect=IntegrityError("unique users.email", {}, Exception("duplicate")),
        ):
            raced_duplicate = self.client.patch(
                f"/api/admin/users/{self.user.id}",
                headers=self.admin_headers,
                json={"email": "race@example.com"},
            )
        self.assertEqual(raced_duplicate.status_code, 409)

        with self.Session() as db:
            event = db.scalar(
                select(AdminAuditEvent).where(
                    AdminAuditEvent.action == "user.profile_updated",
                    AdminAuditEvent.target_user_id == self.user.id,
                )
            )
            self.assertIsNotNone(event)
            self.assertEqual(event.details["after"]["email"], "renamed@example.com")
            self.assertTrue(event.details["sessions_revoked"])
            self.assertNotIn("password", str(event.details).lower())

    def test_admin_can_list_user_projects_with_safe_paginated_metadata(self):
        with self.Session() as db:
            first = Project(
                user_id=self.user.id,
                name="Audi A4",
                vehicle_label="Audi A4 2.0 TDI",
                ecu_label="EDC17C46",
                source_filename="audi-original.bin",
                source_sha256="1" * 64,
                requested_options={"stage": "STAGE1", "options": ["EGR_OFF"]},
            )
            second = Project(
                user_id=self.user.id,
                name="Volvo V60",
                vehicle_label="Volvo V60 D4",
                ecu_label="EDC17CP48",
                source_filename="volvo-original.bin",
                source_sha256="2" * 64,
            )
            foreign = Project(
                user_id=self.admin.id,
                name="Admin-only project",
                source_filename="private.bin",
            )
            db.add_all([first, second, foreign])
            db.flush()
            ready_build = BuildJob(
                user_id=self.user.id,
                project_id=first.id,
                source_filename="audi-original.bin",
                source_path="C:/private/uploads/audi.bin",
                source_sha256="1" * 64,
                source_size_bytes=2048,
                vehicle_label=first.vehicle_label,
                ecu_label=first.ecu_label,
                status="ready",
                progress=100,
                current_stage="Ready",
                result_filename="audi-stage1.bin",
                result_path="C:/private/results/audi-stage1.bin",
                result_sha256="3" * 64,
                revtech_payload={"secret": "never-return-this"},
            )
            older_build = BuildJob(
                user_id=self.user.id,
                project_id=first.id,
                source_filename="audi-original.bin",
                source_path="C:/private/uploads/older-audi.bin",
                source_sha256="1" * 64,
                source_size_bytes=2048,
                status="failed",
                error_message="No match",
            )
            db.add_all([ready_build, older_build])
            db.flush()
            first.last_build_id = ready_build.id
            db.commit()

        page = self.client.get(
            f"/api/admin/users/{self.user.id}/projects",
            headers=self.admin_headers,
            params={"page": 1, "page_size": 1, "sort": "name", "direction": "asc"},
        )
        self.assertEqual(page.status_code, 200)
        self.assertEqual(page.json()["total"], 2)
        self.assertEqual(page.json()["pages"], 2)
        self.assertEqual(page.json()["items"][0]["name"], "Audi A4")
        self.assertEqual(page.json()["items"][0]["build_count"], 2)
        self.assertEqual(page.json()["items"][0]["last_build"]["status"], "ready")
        self.assertNotIn("source_path", page.text)
        self.assertNotIn("result_path", page.text)
        self.assertNotIn("revtech_payload", page.text)
        self.assertNotIn("never-return-this", page.text)

        filtered = self.client.get(
            f"/api/admin/users/{self.user.id}/projects",
            headers=self.admin_headers,
            params={"search": "volvo"},
        )
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.json()["total"], 1)
        self.assertEqual(filtered.json()["items"][0]["name"], "Volvo V60")
        self.assertIsNone(filtered.json()["items"][0]["last_build"])
        self.assertEqual(filtered.json()["items"][0]["build_count"], 0)

        missing = self.client.get(
            "/api/admin/users/does-not-exist/projects",
            headers=self.admin_headers,
        )
        self.assertEqual(missing.status_code, 404)

    def test_create_purchase_is_idempotent_and_receipt_escapes_customer_data(self):
        payload = {
            "user_id": self.user.id,
            "amount_minor": 129900,
            "currency": "sek",
            "description": "<b>Apex Pro</b>",
            "provider": "manual",
            "external_reference": "ORDER-42",
            "idempotency_key": "purchase-test-42",
            "status": "paid",
        }
        first = self.client.post("/api/admin/purchases", headers=self.admin_headers, json=payload)
        second = self.client.post("/api/admin/purchases", headers=self.admin_headers, json=payload)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(first.json()["currency"], "SEK")

        with self.Session() as db:
            self.assertEqual(db.scalar(select(func.count(Purchase.id))), 1)

        receipt = self.client.get(
            first.json()["receipt_url"],
            headers=self.admin_headers,
        )
        self.assertEqual(receipt.status_code, 200)
        self.assertIn("text/html", receipt.headers["content-type"])
        self.assertIn("&lt;script&gt;", receipt.text)
        self.assertNotIn("<script>alert(1)</script>", receipt.text)
        self.assertIn("&lt;b&gt;Apex Pro&lt;/b&gt;", receipt.text)
        self.assertIn("Manual payment record", receipt.text)
        self.assertNotIn("Purchase receipt", receipt.text)
        self.assertEqual(receipt.headers["x-content-type-options"], "nosniff")

    def test_bootstrap_does_not_overwrite_existing_admin_password(self):
        with self.Session() as db:
            existing = db.get(User, self.admin.id)
            original_hash = existing.password_hash
            existing.role = "tuner"
            existing.selected_package = "free"
            db.commit()
            settings = SimpleNamespace(
                temp_admin_enabled=True,
                temp_admin_username=self.admin.email,
                temp_admin_password="a-new-environment-password",
            )
            with patch("app.services.bootstrap.get_settings", return_value=settings):
                ensure_temp_admin_account(db)
            refreshed = db.get(User, self.admin.id)
            self.assertEqual(refreshed.password_hash, original_hash)
            self.assertEqual(refreshed.role, "tuner")
            self.assertEqual(refreshed.selected_package, "free")
            self.assertTrue(verify_password("correct horse battery staple", refreshed.password_hash))
            self.assertFalse(verify_password("a-new-environment-password", refreshed.password_hash))


if __name__ == "__main__":
    unittest.main()
