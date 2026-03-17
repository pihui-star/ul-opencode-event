// tests/utils/mock-transport.ts
import * as nodemailer from 'nodemailer';

export interface CapturedEmail {
  from?: string;
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

export interface MockTransportResult {
  capturedEmails: CapturedEmail[];
  transport: nodemailer.Transporter;
  reset: () => void;
}

export function createMockTransport(): MockTransportResult {
  const capturedEmails: CapturedEmail[] = [];
  
  const transport = nodemailer.createTransport({
    jsonTransport: true,  // Captures emails as JSON instead of sending
  });
  
  // Override sendMail to capture
  const originalSendMail = transport.sendMail.bind(transport);
  transport.sendMail = async (mailOptions: any): Promise<any> => {
    capturedEmails.push({
      from: mailOptions.from,
      to: mailOptions.to,
      subject: mailOptions.subject,
      text: mailOptions.text,
      html: mailOptions.html,
    });
    return { 
      messageId: `mock-${Date.now()}`,
      response: 'Mocked',
      envelope: { from: mailOptions.from, to: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to] },
      message: '',
      accepted: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
      rejected: [],
      pending: [],
    };
  };
  
  const reset = () => {
    capturedEmails.length = 0;
  };
  
  return { capturedEmails, transport, reset };
}
