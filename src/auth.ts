import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { env } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { scope: "openid email profile" } },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    error: "/auth/error",
  },
  callbacks: {
    async signIn({ user, account }) {
      if (!account || account.provider !== "google" || !user.email) {
        return false;
      }

      // Single-tenant app (CONSTITUTION.md §3) — only the owner's account
      // may sign in. Without this, anyone who finds the deployed URL could
      // sign in with their own Google account and get their own (empty)
      // profile, which isn't what "single-tenant" is meant to guarantee.
      if (env.ALLOWED_USER_EMAIL && user.email !== env.ALLOWED_USER_EMAIL) {
        console.error(`Sign-in rejected for non-owner email: ${user.email}`);
        return false;
      }

      const supabase = getSupabaseServerClient();
      const { error } = await supabase.from("users").upsert(
        {
          google_id: account.providerAccountId,
          email: user.email,
        },
        { onConflict: "google_id" },
      );

      if (error) {
        console.error("Failed to upsert user on sign-in:", error.message);
        return false;
      }

      return true;
    },
  },
});
