'use client';

import { useState, type SyntheticEvent } from 'react';
import { LockKeyhole } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BASE_PATH } from '@/lib/constants';

export function AdminLoginForm({ configured }: { configured: boolean }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      const response = await fetch(`${BASE_PATH}/admin/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: form.get('password') }),
      });
      const body = (await response.json()) as {
        error?: string;
        redirect?: string;
      };
      if (!response.ok) throw new Error(body.error ?? '登录失败');
      window.location.assign(body.redirect ?? `${BASE_PATH}/admin`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="admin-login-form" onSubmit={submit}>
      <label htmlFor="admin-password">管理员密码</label>
      <Input
        id="admin-password"
        name="password"
        type="password"
        autoComplete="current-password"
        disabled={!configured || pending}
        required
      />
      {!configured ? (
        <p className="form-notice">
          请先在服务器环境中设置 ADMIN_PASSWORD 并首次启动。
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={!configured || pending}>
        <LockKeyhole />
        {pending ? '正在验证…' : '进入后台'}
      </Button>
    </form>
  );
}
