import { templateParamCount, toWhatsAppNumber, whatsAppParam, whatsappConnectSchema } from './whatsapp';

describe('WhatsApp helpers', () => {
  it('turns local numbers into international WhatsApp numbers', () => {
    expect(toWhatsAppNumber('0300 1234567', 'PK')).toBe('923001234567');
    expect(toWhatsAppNumber('+92 300 1234567', 'AU')).toBe('923001234567');
    expect(toWhatsAppNumber('0092-300-1234567', 'PK')).toBe('923001234567');
    expect(toWhatsAppNumber('0412 345 678', 'AU')).toBe('61412345678');
    expect(toWhatsAppNumber('412345678', 'AU')).toBe('61412345678');
    expect(toWhatsAppNumber('923001234567', 'PK')).toBe('923001234567');
    expect(toWhatsAppNumber('12345', 'PK')).toBeNull();
    expect(toWhatsAppNumber(null, 'PK')).toBeNull();
  });

  it('makes template values WhatsApp accepts', () => {
    expect(whatsAppParam('Line one\nLine two')).toBe('Line one · Line two');
    expect(whatsAppParam('')).toBe('–');
    expect(whatsAppParam(null)).toBe('–');
    expect(whatsAppParam('a      b')).toBe('a   b');
  });

  it('counts template placeholders and checks the connection form', () => {
    expect(templateParamCount('Hi {{1}}, {{2}} is due on {{3}}')).toBe(3);
    expect(templateParamCount('No values')).toBe(0);
    expect(whatsappConnectSchema.safeParse({ phoneNumberId: '1234567890', businessAccountId: '9876543210', accessToken: 'EAAG' + 'x'.repeat(40) }).success).toBe(true);
    expect(whatsappConnectSchema.safeParse({ phoneNumberId: 'abc', businessAccountId: '9876543210' }).success).toBe(false);
  });
});
