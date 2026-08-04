import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AdminApp from './admin/AdminApp';
import './index.css';
import './admin/admin.css';

const isAdminBuild = String(import.meta.env.VITE_APP_MODE || '').toLowerCase() === 'admin';
document.body.classList.toggle('admin-body', isAdminBuild);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdminBuild ? <AdminApp /> : <App />}
  </StrictMode>,
);
