from __future__ import annotations

import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import Base, get_db
from app.models import AdminAuditEvent, BuildJob, Purchase, Subscription, User, utcnow
from app.routers import admin as admin_router
from app.routers import auth as auth_router
from app.security import create_token, hash_password, read_token, verify_password
from app.services.bootstrap import ensure_temp_admin_account


ADMIN_ORIGIN = "https://admin.apex.test"


class AdminSecurityContractTests(unittest.TestCase):
    """Security and behaviour contracts backed only by an in-memory test database."""

    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, expire_on_commit=False)

        with self.Session() as db:
            self.admin = User(
                email="owner@apex.test",
                password_hash=hash_password("owner-password-is-long"),
                display_name="Primary Owner",
                company_name="Apex Files",
                selected_package="pro",
                role="admin",
            )
            self.second_admin = User(
                email="second-admin@apex.test",
                password_hash=hash_password("second-admin-password"),
                display_name="Second Admin",
                company_name="Apex Files",
                selected_package="pro",
                role="admin",
            )
            self.customer = User(
                email="customer@example.test",
                password_hash=hash_password("customer-password"),
                display_name="Customer",
                company_name='<script data-secret="x">alert(1)</script>',
                vat_number="SE123456789",
                country="SE",
                selected_package="free",
                role="tuner",
            )
            db.add_all([self.admin, self.second_admin, self.customer])
            db.flush()
            for user, plan, limit in (
                (self.admin, "Apex Pro", 9999),
                (self.second_admin, "Apex Pro", 9999),
                (self.customer, "Apex Free", 1),
            ):
                db.add(
                    Subscription(
                        user_id=user.id,
                        plan_name=plan,
                        monthly_file_limit=limit,
                        period_ends_at=utcnow() + timedelta(days=30),
                    )
                )
            db.add(
                BuildJob(
                    user_id=self.customer.id,
                    source_filename="customer.bin",
                    source_path="C:/private/uploads/never-expose.bin",
                    source_sha256="a" * 64,
                    source_size_bytes=1024,
                    status="ready",
                    result_path="C:/private/results/never-expose.bin",
                    result_filename="customer-ready.bin",
                    result_sha256="b" * 64,
                    revtech_payload={"service_token": "never-expose-this"},
                )
            )
            db.commit()

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
        self.origin_settings = patch(
            "app.deps.get_settings",
            return_value=SimpleNamespace(admin_origins=[ADMIN_ORIGIN]),
        )
        self.origin_settings.start()
        self.client = TestClient(app)
        self.admin_token = create_token(
            self.admin.id,
            session_version=self.admin.session_version,
            audience="admin",
        )
        self.admin_headers = {
            "Authorization": f"Bearer {self.admin_token}",
            "Origin": ADMIN_ORIGIN,
        }
        with admin_router._admin_login_lock:
            admin_router._admin_login_failures.clear()

    def tearDown(self) -> None:
        self.client.close()
        self.origin_settings.stop()
        self.engine.dispose()

    def _app_token(self, user: User | None = None, *, session_version: int | None = None) -> str:
        account = user or self.customer
        version = account.session_version if session_version is None else session_version
        return create_token(account.id, session_version=version, audience="app")

    def _admin_request_headers(self, token: str | None = None, origin: str | None = ADMIN_ORIGIN) -> dict[str, str]:
        headers = {"Authorization": f"Bearer {token or self.admin_token}"}
        if origin is not None:
            headers["Origin"] = origin
        return headers

    def test_app_and_admin_token_audiences_are_isolated_both_directions(self) -> None:
        app_token_for_admin = create_token(self.admin.id, session_version=0, audience="app")
        response = self.client.get(
            "/api/admin/overview",
            headers=self._admin_request_headers(app_token_for_admin),
        )
        self.assertEqual(response.status_code, 401)

        response = self.client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {self.admin_token}"},
        )
        self.assertEqual(response.status_code, 401)

        tuner_admin_token = create_token(self.customer.id, session_version=0, audience="admin")
        response = self.client.get(
            "/api/admin/overview",
            headers=self._admin_request_headers(tuner_admin_token),
        )
        self.assertEqual(response.status_code, 403)

        expired = create_token(
            self.admin.id,
            expires_delta=timedelta(seconds=-5),
            session_version=0,
            audience="admin",
        )
        response = self.client.get(
            "/api/admin/overview",
            headers=self._admin_request_headers(expired),
        )
        self.assertEqual(response.status_code, 401)

    def test_admin_origin_is_exact_and_applies_to_login_and_authenticated_routes(self) -> None:
        for bad_origin in (
            "null",
            "https://customer.apex.test",
            f"{ADMIN_ORIGIN}.evil.example",
            "https://evil.example/https://admin.apex.test",
        ):
            with self.subTest(origin=bad_origin):
                response = self.client.get(
                    "/api/admin/overview",
                    headers=self._admin_request_headers(origin=bad_origin),
                )
                self.assertEqual(response.status_code, 403)

        allowed = self.client.get("/api/admin/overview", headers=self.admin_headers)
        self.assertEqual(allowed.status_code, 200)
        trailing_slash = self.client.get(
            "/api/admin/overview",
            headers=self._admin_request_headers(origin=f"{ADMIN_ORIGIN}/"),
        )
        self.assertEqual(trailing_slash.status_code, 200)
        non_browser = self.client.get(
            "/api/admin/overview",
            headers=self._admin_request_headers(origin=None),
        )
        self.assertEqual(non_browser.status_code, 200)

        login = self.client.post(
            "/api/admin/auth/login",
            headers={"Origin": "https://evil.example"},
            json={"email": self.admin.email, "password": "owner-password-is-long"},
        )
        self.assertEqual(login.status_code, 403)

    def test_admin_login_is_admin_only_short_lived_and_rate_limited(self) -> None:
        tuner = self.client.post(
            "/api/admin/auth/login",
            headers={"Origin": ADMIN_ORIGIN},
            json={"email": self.customer.email, "password": "customer-password"},
        )
        self.assertEqual(tuner.status_code, 401)

        success = self.client.post(
            "/api/admin/auth/login",
            headers={"Origin": ADMIN_ORIGIN},
            json={"email": self.admin.email, "password": "owner-password-is-long"},
        )
        self.assertEqual(success.status_code, 200)
        payload = read_token(success.json()["token"])
        self.assertIsNotNone(payload)
        self.assertEqual(payload["aud"], "admin")
        self.assertEqual(payload["sv"], 0)
        self.assertLessEqual(payload["exp"] - payload["iat"], 8 * 60 * 60)

        for attempt in range(5):
            response = self.client.post(
                "/api/admin/auth/login",
                headers={"Origin": ADMIN_ORIGIN, "X-Forwarded-For": "192.0.2.44"},
                json={"email": "missing@apex.test", "password": f"wrong-{attempt}"},
            )
            self.assertEqual(response.status_code, 401)
        blocked = self.client.post(
            "/api/admin/auth/login",
            headers={"Origin": ADMIN_ORIGIN, "X-Forwarded-For": "192.0.2.44"},
            json={"email": "missing@apex.test", "password": "still-wrong"},
        )
        self.assertEqual(blocked.status_code, 429)

    def test_inactive_and_session_version_changes_revoke_tokens(self) -> None:
        old_app_token = self._app_token()
        self.assertEqual(
            self.client.get(
                "/api/auth/me",
                headers={"Authorization": f"Bearer {old_app_token}"},
            ).status_code,
            200,
        )

        disabled = self.client.patch(
            f"/api/admin/users/{self.customer.id}/status",
            headers=self.admin_headers,
            json={"is_active": False},
        )
        self.assertEqual(disabled.status_code, 200)
        self.assertFalse(disabled.json()["is_active"])
        self.assertEqual(
            self.client.get(
                "/api/auth/me",
                headers={"Authorization": f"Bearer {old_app_token}"},
            ).status_code,
            401,
        )

        enabled = self.client.patch(
            f"/api/admin/users/{self.customer.id}/status",
            headers=self.admin_headers,
            json={"is_active": True},
        )
        self.assertEqual(enabled.status_code, 200)
        self.assertEqual(
            self.client.get(
                "/api/auth/me",
                headers={"Authorization": f"Bearer {old_app_token}"},
            ).status_code,
            401,
        )

        with self.Session() as db:
            refreshed = db.get(User, self.customer.id)
            wrong_version = create_token(
                refreshed.id,
                session_version=refreshed.session_version - 1,
                audience="app",
            )
        self.assertEqual(
            self.client.get(
                "/api/auth/me",
                headers={"Authorization": f"Bearer {wrong_version}"},
            ).status_code,
            401,
        )

    def test_public_registration_always_creates_free_app_account(self) -> None:
        for index, requested_package in enumerate(("lite", "pro"), start=1):
            with self.subTest(package=requested_package):
                response = self.client.post(
                    "/api/auth/register",
                    json={
                        "email": f"public-{index}@example.com",
                        "password": "public-registration-password",
                        "display_name": "Public User",
                        "package_key": requested_package,
                    },
                )
                self.assertEqual(response.status_code, 200)
                body = response.json()
                self.assertEqual(body["user"]["selected_package"], "free")
                token_payload = read_token(body["token"])
                self.assertEqual(token_payload["aud"], "app")
                user_id = body["user"]["id"]
                with self.Session() as db:
                    user = db.get(User, user_id)
                    subscription = db.scalar(
                        select(Subscription).where(Subscription.user_id == user_id)
                    )
                    self.assertEqual(user.role, "tuner")
                    self.assertEqual(user.selected_package, "free")
                    self.assertEqual(subscription.plan_name, "Apex Free")
                    self.assertEqual(subscription.monthly_file_limit, 1)

    def test_password_minimum_is_ten_across_registration_and_admin_flows(self) -> None:
        too_short_registration = self.client.post(
            "/api/auth/register",
            json={"email": "short-public@example.com", "password": "123456789"},
        )
        self.assertEqual(too_short_registration.status_code, 422)

        registration = self.client.post(
            "/api/auth/register",
            json={"email": "ten-public@example.com", "password": "1234567890"},
        )
        self.assertEqual(registration.status_code, 200)

        too_short_admin_create = self.client.post(
            "/api/admin/users",
            headers=self.admin_headers,
            json={"email": "short-admin-create@example.com", "password": "123456789"},
        )
        self.assertEqual(too_short_admin_create.status_code, 422)

        admin_create = self.client.post(
            "/api/admin/users",
            headers=self.admin_headers,
            json={"email": "ten-admin-create@example.com", "password": "1234567890"},
        )
        self.assertEqual(admin_create.status_code, 201)

        too_short_reset = self.client.post(
            f"/api/admin/users/{self.customer.id}/password-reset",
            headers=self.admin_headers,
            json={"temporary_password": "123456789"},
        )
        self.assertEqual(too_short_reset.status_code, 422)

        reset = self.client.post(
            f"/api/admin/users/{self.customer.id}/password-reset",
            headers=self.admin_headers,
            json={"temporary_password": "1234567890"},
        )
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.json()["temporary_password"], "1234567890")

        with self.Session() as db:
            public_user = db.scalar(select(User).where(User.email == "ten-public@example.com"))
            admin_created_user = db.scalar(
                select(User).where(User.email == "ten-admin-create@example.com")
            )
            reset_user = db.get(User, self.customer.id)
            self.assertTrue(verify_password("1234567890", public_user.password_hash))
            self.assertTrue(verify_password("1234567890", admin_created_user.password_hash))
            self.assertTrue(verify_password("1234567890", reset_user.password_hash))

    def test_bootstrap_is_disabled_by_default_and_strictly_create_only(self) -> None:
        with self.Session() as db:
            disabled = SimpleNamespace(
                temp_admin_enabled=False,
                temp_admin_username="bootstrap@apex.test",
                temp_admin_password="bootstrap-password",
            )
            with patch("app.services.bootstrap.get_settings", return_value=disabled):
                ensure_temp_admin_account(db)
            self.assertIsNone(
                db.scalar(select(User).where(User.email == "bootstrap@apex.test"))
            )

            missing_credentials = SimpleNamespace(
                temp_admin_enabled=True,
                temp_admin_username="",
                temp_admin_password="",
            )
            with patch(
                "app.services.bootstrap.get_settings",
                return_value=missing_credentials,
            ):
                ensure_temp_admin_account(db)
            self.assertIsNone(db.scalar(select(User).where(User.email == "")))

            enabled = SimpleNamespace(
                temp_admin_enabled=True,
                temp_admin_username="bootstrap@apex.test",
                temp_admin_password="bootstrap-password",
            )
            with patch("app.services.bootstrap.get_settings", return_value=enabled):
                ensure_temp_admin_account(db)
            created = db.scalar(select(User).where(User.email == "bootstrap@apex.test"))
            self.assertIsNotNone(created)
            self.assertEqual(created.role, "admin")
            self.assertTrue(verify_password("bootstrap-password", created.password_hash))
            created.password_hash = hash_password("manually-rotated-password")
            created.display_name = "Permanent Owner"
            db.commit()

            with patch("app.services.bootstrap.get_settings", return_value=enabled):
                ensure_temp_admin_account(db)
            unchanged = db.get(User, created.id)
            self.assertEqual(unchanged.display_name, "Permanent Owner")
            self.assertTrue(
                verify_password("manually-rotated-password", unchanged.password_hash)
            )
            self.assertFalse(verify_password("bootstrap-password", unchanged.password_hash))

    def test_bootstrap_never_promotes_or_changes_an_existing_matching_user(self) -> None:
        with self.Session() as db:
            original = db.get(User, self.customer.id)
            original_hash = original.password_hash
            settings = SimpleNamespace(
                temp_admin_enabled=True,
                temp_admin_username=original.email,
                temp_admin_password="attempted-bootstrap-overwrite",
            )
            with patch("app.services.bootstrap.get_settings", return_value=settings):
                ensure_temp_admin_account(db)
            unchanged = db.get(User, original.id)
            self.assertEqual(unchanged.role, "tuner")
            self.assertEqual(unchanged.password_hash, original_hash)
            self.assertTrue(verify_password("customer-password", unchanged.password_hash))

    def test_admin_user_crud_protects_sessions_self_access_and_internal_fields(self) -> None:
        create_response = self.client.post(
            "/api/admin/users",
            headers=self.admin_headers,
            json={
                "email": "created@example.com",
                "password": "created-user-password",
                "display_name": "Created User",
                "company_name": "Created Company",
                "role": "tuner",
                "package_key": "lite",
            },
        )
        self.assertEqual(create_response.status_code, 201)
        created = create_response.json()
        created_id = created["id"]
        self.assertEqual(created["subscription"]["plan_name"], "Apex Lite")
        for forbidden in (
            "password_hash",
            "session_version",
            "source_path",
            "result_path",
            "revtech_payload",
            "never-expose-this",
        ):
            self.assertNotIn(forbidden, create_response.text)

        duplicate = self.client.post(
            "/api/admin/users",
            headers=self.admin_headers,
            json={
                "email": "CREATED@example.com",
                "password": "another-created-password",
            },
        )
        self.assertEqual(duplicate.status_code, 409)

        app_login = self.client.post(
            "/api/auth/login",
            json={"email": "created@example.com", "password": "created-user-password"},
        )
        self.assertEqual(app_login.status_code, 200)
        old_token = app_login.json()["token"]
        updated = self.client.patch(
            f"/api/admin/users/{created_id}",
            headers=self.admin_headers,
            json={"email": "renamed@example.com", "company_name": "Renamed"},
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["email"], "renamed@example.com")
        self.assertEqual(
            self.client.get(
                "/api/auth/me",
                headers={"Authorization": f"Bearer {old_token}"},
            ).status_code,
            401,
        )

        self_demotion = self.client.patch(
            f"/api/admin/users/{self.admin.id}",
            headers=self.admin_headers,
            json={"role": "tuner"},
        )
        self.assertEqual(self_demotion.status_code, 409)
        self_disable = self.client.patch(
            f"/api/admin/users/{self.admin.id}/status",
            headers=self.admin_headers,
            json={"is_active": False},
        )
        self.assertEqual(self_disable.status_code, 409)

        detail = self.client.get(
            f"/api/admin/users/{self.customer.id}",
            headers=self.admin_headers,
        )
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()["stats"]["total_builds"], 1)
        for forbidden in (
            "password_hash",
            "session_version",
            "source_path",
            "result_path",
            "revtech_payload",
            "never-expose-this",
            "C:/private",
        ):
            self.assertNotIn(forbidden, detail.text)

    def test_password_reset_and_subscription_updates_are_validated_and_audited(self) -> None:
        old_token = self._app_token()
        reset = self.client.post(
            f"/api/admin/users/{self.customer.id}/password-reset",
            headers=self.admin_headers,
            json={"temporary_password": "explicit-temporary-password"},
        )
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.json()["temporary_password"], "explicit-temporary-password")
        self.assertEqual(
            self.client.get(
                "/api/auth/me",
                headers={"Authorization": f"Bearer {old_token}"},
            ).status_code,
            401,
        )

        too_short = self.client.post(
            f"/api/admin/users/{self.customer.id}/password-reset",
            headers=self.admin_headers,
            json={"temporary_password": "short"},
        )
        self.assertEqual(too_short.status_code, 422)

        subscription = self.client.patch(
            f"/api/admin/users/{self.customer.id}/subscription",
            headers=self.admin_headers,
            json={
                "package_key": "lite",
                "files_used_this_period": 7,
                "status": "active",
            },
        )
        self.assertEqual(subscription.status_code, 200)
        self.assertEqual(subscription.json()["plan_name"], "Apex Lite")
        self.assertEqual(subscription.json()["monthly_file_limit"], 20)
        self.assertEqual(subscription.json()["files_used_this_period"], 7)

        invalid_period = self.client.patch(
            f"/api/admin/users/{self.customer.id}/subscription",
            headers=self.admin_headers,
            json={
                "period_started_at": "2030-02-02T00:00:00Z",
                "period_ends_at": "2030-02-01T00:00:00Z",
            },
        )
        self.assertEqual(invalid_period.status_code, 422)

        with self.Session() as db:
            reset_event = db.scalar(
                select(AdminAuditEvent).where(
                    AdminAuditEvent.action == "user.password_reset"
                )
            )
            self.assertEqual(reset_event.details, {"sessions_revoked": True})
            serialized_details = str(reset_event.details).lower()
            self.assertNotIn("explicit-temporary-password", serialized_details)
            self.assertNotIn("password_hash", serialized_details)
            actions = set(db.scalars(select(AdminAuditEvent.action)).all())
            self.assertIn("subscription.updated", actions)

    def test_purchase_idempotency_conflicts_receipt_security_and_manual_labelling(self) -> None:
        payload = {
            "user_id": self.customer.id,
            "amount_minor": 149900,
            "currency": "sek",
            "description": '<img src=x onerror="alert(1)"> Apex Pro',
            "provider": "manual",
            "external_reference": '\"><script>alert(2)</script>',
            "idempotency_key": "manual-order-100",
            "status": "paid",
            "notes": "Verified manual bank transfer",
        }
        first = self.client.post(
            "/api/admin/purchases", headers=self.admin_headers, json=payload
        )
        replay = self.client.post(
            "/api/admin/purchases", headers=self.admin_headers, json=payload
        )
        self.assertEqual(first.status_code, 201)
        self.assertEqual(replay.status_code, 201)
        self.assertEqual(first.json()["id"], replay.json()["id"])
        self.assertEqual(first.json()["currency"], "SEK")

        conflicting = dict(payload)
        conflicting["status"] = "refunded"
        conflict_response = self.client.post(
            "/api/admin/purchases",
            headers=self.admin_headers,
            json=conflicting,
        )
        self.assertEqual(
            conflict_response.status_code,
            409,
            "Reusing an idempotency key with any materially different payload must conflict",
        )

        with self.Session() as db:
            self.assertEqual(db.scalar(select(func.count(Purchase.id))), 1)
            self.assertEqual(
                db.scalar(
                    select(func.count(AdminAuditEvent.id)).where(
                        AdminAuditEvent.action == "purchase.created"
                    )
                ),
                1,
            )

        app_token_receipt = self.client.get(
            first.json()["receipt_url"],
            headers={
                "Authorization": f"Bearer {self._app_token()}",
                "Origin": ADMIN_ORIGIN,
            },
        )
        self.assertEqual(app_token_receipt.status_code, 401)
        bad_origin_receipt = self.client.get(
            first.json()["receipt_url"],
            headers=self._admin_request_headers(origin="https://evil.example"),
        )
        self.assertEqual(bad_origin_receipt.status_code, 403)

        receipt = self.client.get(
            first.json()["receipt_url"], headers=self.admin_headers
        )
        self.assertEqual(receipt.status_code, 200)
        self.assertIn("Manual payment record", receipt.text)
        self.assertIn("does not replace an official receipt or tax invoice", receipt.text)
        self.assertNotIn('<script data-secret="x">', receipt.text)
        self.assertNotIn('<img src=x onerror="alert(1)">', receipt.text)
        self.assertIn("&lt;script", receipt.text)
        self.assertEqual(receipt.headers["cache-control"], "private, no-store")
        self.assertEqual(receipt.headers["x-content-type-options"], "nosniff")
        self.assertIn("frame-ancestors 'none'", receipt.headers["content-security-policy"])

    def test_audit_and_resource_pagination_are_bounded_and_do_not_leak_secrets(self) -> None:
        for index in range(4):
            response = self.client.post(
                "/api/admin/users",
                headers=self.admin_headers,
                json={
                    "email": f"page-{index}@example.com",
                    "password": f"pagination-password-{index}",
                    "display_name": f"Page User {index}",
                },
            )
            self.assertEqual(response.status_code, 201)

        page_one = self.client.get(
            "/api/admin/users",
            headers=self.admin_headers,
            params={"page": 1, "page_size": 2, "sort": "email", "direction": "asc"},
        )
        page_two = self.client.get(
            "/api/admin/users",
            headers=self.admin_headers,
            params={"page": 2, "page_size": 2, "sort": "email", "direction": "asc"},
        )
        self.assertEqual(page_one.status_code, 200)
        self.assertEqual(page_two.status_code, 200)
        self.assertEqual(page_one.json()["page_size"], 2)
        self.assertTrue(
            set(item["id"] for item in page_one.json()["items"]).isdisjoint(
                item["id"] for item in page_two.json()["items"]
            )
        )

        injection_search = self.client.get(
            "/api/admin/users",
            headers=self.admin_headers,
            params={"search": "' OR 1=1 --"},
        )
        self.assertEqual(injection_search.status_code, 200)
        self.assertEqual(injection_search.json()["total"], 0)

        for params in (
            {"page": 0},
            {"page_size": 101},
            {"sort": "email; DROP TABLE users"},
            {"direction": "sideways"},
        ):
            with self.subTest(params=params):
                invalid = self.client.get(
                    "/api/admin/users", headers=self.admin_headers, params=params
                )
                self.assertEqual(invalid.status_code, 422)

        audit_page = self.client.get(
            "/api/admin/audit-events",
            headers=self.admin_headers,
            params={"page": 1, "page_size": 2, "action": "user.created"},
        )
        self.assertEqual(audit_page.status_code, 200)
        self.assertEqual(audit_page.json()["page_size"], 2)
        self.assertGreaterEqual(audit_page.json()["total"], 4)
        self.assertTrue(
            all(item["action"] == "user.created" for item in audit_page.json()["items"])
        )
        for secret in (
            "password_hash",
            "pagination-password",
            "service_token",
            "never-expose-this",
            "source_path",
            "result_path",
        ):
            self.assertNotIn(secret, audit_page.text)

        invalid_audit_page = self.client.get(
            "/api/admin/audit-events",
            headers=self.admin_headers,
            params={"page_size": 101},
        )
        self.assertEqual(invalid_audit_page.status_code, 422)


if __name__ == "__main__":
    unittest.main()
