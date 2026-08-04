import nodemailer from 'nodemailer';

let transporter = null;

const getTransporter = () => {
    if (transporter) return transporter;

    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    // Gmail app passwords are often pasted with spaces — strip them
    const pass = String(process.env.SMTP_PASS || '').replace(/\s+/g, '');

    if (!host || !user || !pass) {
        return null;
    }

    transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465 || String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth: { user, pass }
    });

    return transporter;
};

export const isEmailConfigured = () => Boolean(getTransporter());

const buildFromAddress = () => {
    if (process.env.SMTP_FROM) return process.env.SMTP_FROM;
    const name = process.env.SMTP_FROM_NAME || 'Kincore';
    const address = process.env.SMTP_FROM_ADDRESS || process.env.SMTP_USER || 'noreply@kincore.local';
    return `${name} <${address}>`;
};

/**
 * Send an email when SMTP is configured; otherwise return a mock/sent-false result.
 */
export const sendEmail = async ({ to, subject, html, text }) => {
    const from = buildFromAddress();
    const tx = getTransporter();

    if (!tx) {
        console.log(`[EmailService] SMTP not configured. Mock email → ${to} | ${subject}`);
        return {
            ok: true,
            mocked: true,
            provider: 'mock',
            messageId: `mock-${Date.now()}`,
            to,
            subject
        };
    }

    try {
        const info = await tx.sendMail({
            from,
            to,
            subject,
            text: text || subject,
            html: html || `<p>${text || subject}</p>`
        });
        return {
            ok: true,
            mocked: false,
            provider: 'smtp',
            messageId: info.messageId,
            to,
            subject
        };
    } catch (err) {
        console.error('[EmailService] send failed:', err.message);
        return {
            ok: false,
            mocked: false,
            provider: 'smtp',
            error: err.message,
            to,
            subject
        };
    }
};
