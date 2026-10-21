import { env } from '../../config/env';

/** An error from Meta's Graph API, with a message staff can act on. */
export class GraphError extends Error {
  constructor(
    message: string,
    readonly code?: number,
    readonly status?: number,
  ) {
    super(message);
  }
}

interface MetaError {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_data?: { details?: string };
  title?: string;
}

/** Meta's error codes in plain words (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes). */
export function friendlyWhatsAppError(e: MetaError | undefined, fallback = 'WhatsApp did not accept the request'): string {
  if (!e) return fallback;
  switch (e.code) {
    case 190:
      return 'The access token is not valid or has expired. Create a permanent token (System User) in Meta Business settings and paste it again.';
    case 10:
    case 200:
    case 294:
      return 'The access token does not have permission for this WhatsApp account. Give the System User the whatsapp_business_messaging and whatsapp_business_management permissions.';
    case 100:
      return e.error_subcode === 33 ? 'The Phone number ID or WhatsApp Business Account ID was not found, or this token cannot use it. Check both numbers in WhatsApp Manager → API setup.' : `WhatsApp rejected a value: ${e.error_data?.details ?? e.message ?? 'invalid parameter'}`;
    case 131047:
      return 'More than 24 hours have passed since the client last messaged you, so WhatsApp only allows an approved template. Link a template for this kind of message in Settings → Integrations → WhatsApp.';
    case 131026:
      return 'This number cannot receive WhatsApp messages (not on WhatsApp, or an old version of WhatsApp).';
    case 131030:
      return 'This number is not on the test number’s allowed list. Add it in WhatsApp Manager → API setup, or use your own business number.';
    case 131056:
      return 'Too many messages to this number in a short time. WhatsApp will accept more shortly.';
    case 130429:
    case 80007:
    case 4:
      return 'WhatsApp’s sending limit was reached. Messages will be retried automatically.';
    case 132000:
      return 'The number of values does not match the template’s {{1}}, {{2}}… Check the template link in Settings → Integrations → WhatsApp.';
    case 132001:
      return 'The template does not exist in this language, or is not approved yet. Check the template link in Settings → Integrations → WhatsApp.';
    case 132007:
      return 'The template text breaks WhatsApp’s formatting rules.';
    case 132015:
    case 132016:
      return 'The template has been paused or disabled by WhatsApp because of low quality. Choose another approved template.';
    case 133010:
      return 'This phone number is not registered with WhatsApp Cloud API yet. Finish registration in WhatsApp Manager.';
    case 368:
    case 131031:
      return 'WhatsApp has temporarily restricted this business account. Check WhatsApp Manager for details.';
    case 131042:
      return 'There is a payment problem on the WhatsApp Business account. Add a payment method in Meta Business settings.';
    case 131049:
      return 'WhatsApp chose not to deliver this marketing-style message to keep engagement healthy. Try again later or use a utility template.';
    case 131051:
      return 'This kind of message is not supported by WhatsApp.';
    default:
      return e.error_data?.details || e.title || e.message || fallback;
  }
}

/** Retrying makes no sense for these (a person has to fix something first). */
export const PERMANENT_ERRORS = new Set([190, 10, 200, 294, 100, 131026, 131030, 132000, 132001, 132007, 132015, 132016, 133010, 131042, 131051]);

/** One call to the Graph API with the clinic's token (15 s timeout). */
export async function graph<T>(token: string, method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const { WHATSAPP_GRAPH_URL, WHATSAPP_API_VERSION } = env();
  let res: Response;
  try {
    res = await fetch(`${WHATSAPP_GRAPH_URL.replace(/\/$/, '')}/${WHATSAPP_API_VERSION}/${path.replace(/^\//, '')}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new GraphError(`Could not reach WhatsApp (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message}). Check the server’s internet connection.`);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: MetaError } & T;
  if (!res.ok || json.error) throw new GraphError(friendlyWhatsAppError(json.error, `WhatsApp returned an error (${res.status})`), json.error?.code, res.status);
  return json;
}

export interface GraphPhoneNumber {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

export interface GraphTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  components?: { type: string; format?: string; text?: string; example?: unknown }[];
}
