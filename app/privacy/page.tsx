import { OWNER_EMAIL } from "@/lib/env";

export const metadata = { title: "Privacy · Daybook" };

export default function PrivacyPage() {
  return (
    <main className="relative z-[1] mx-auto max-w-2xl px-6 py-16">
      <div className="ruled px-8 py-10" style={{ ["--margin-x" as string]: "2.25rem" }}>
        <h1 className="display pl-6 text-4xl italic">Privacy</h1>
        <div className="mt-6 grid gap-4 pl-6 text-ink2">
          <p>
            Daybook is a personal planner used by one person ({OWNER_EMAIL}). No other accounts can sign in.
          </p>
          <p>
            It reads and edits that account&apos;s Google Calendar events so they appear alongside tasks. Calendar data is
            used only to show and update those events inside Daybook. It is never sold, shared, or used for ads.
          </p>
          <p>
            Tasks, lists and hours are stored in a private database. Google access can be removed at any time from
            Daybook&apos;s Settings or at myaccount.google.com/permissions.
          </p>
          <p>Questions: {OWNER_EMAIL}</p>
        </div>
      </div>
    </main>
  );
}
