function sendEmail(message: string) {
  return fetch('https://api.resend.com/emails', { method: 'POST', body: message });
}
function sendSms(message: string) {
  return fetch('https://api.twilio.com/messages', { method: 'POST', body: message });
}

const senders = { email: sendEmail, sms: sendSms };

export async function notify(message: string) {
  await senders[process.env.NOTIFY_CHANNEL as 'email' | 'sms'](message);
}
