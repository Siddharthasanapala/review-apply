import Link from "next/link";

export default function AuthErrorPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Sign-in didn&apos;t go through</h1>
      <p className="max-w-md text-sm text-gray-600 dark:text-gray-400">
        Either the sign-in was cancelled or something went wrong on
        Google&apos;s side. No data was changed. You can try again.
      </p>
      <Link
        href="/"
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
      >
        Back to sign-in
      </Link>
    </main>
  );
}
