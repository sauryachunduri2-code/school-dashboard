import { sendNotification, setVapidDetails } from "web-push";

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult = { delivered: number; gone: string[]; failed: number };

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) throw new Error("VAPID keys are not set");
  setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:sauryachunduri2@gmail.com", pub, priv);
  configured = true;
}

/** Send one payload to every subscription. Reports dead endpoints (404/410) so callers can delete them. */
export async function sendPush(subs: StoredSubscription[], payload: unknown): Promise<PushResult> {
  configure();
  const out: PushResult = { delivered: 0, gone: [], failed: 0 };
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), {
          TTL: 3600,
          urgency: "high",
        });
        out.delivered++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) out.gone.push(s.endpoint);
        else out.failed++;
      }
    }),
  );
  return out;
}
