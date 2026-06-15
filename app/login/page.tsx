import { LoginForm } from "./login-form";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f7f4ef] px-5 py-10">
      <section className="w-full max-w-sm">
        <div className="mb-8">
          <p className="mb-2 text-sm text-neutral-500">你和你</p>
          <h1 className="text-3xl font-semibold tracking-normal text-neutral-950">
            先确认一下是你
          </h1>
          <p className="mt-3 text-base leading-7 text-neutral-600">
            用邮箱和密码登录。第一次用的话，先注册一个账号。
          </p>
        </div>

        <LoginForm />

        <AuthError searchParams={searchParams} />
      </section>
    </main>
  );
}

async function AuthError({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  if (params.error !== "auth") {
    return null;
  }

  return (
    <p className="mt-4 text-sm text-red-600">
      登录链接好像失效了。没事，再发一封新的就行。
    </p>
  );
}
