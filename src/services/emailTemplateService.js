import { supabase } from '../config/supabaseClient.js';

/** Kincore brand (matches frontend tailwind brand.orange) */
export const DEFAULT_EMAIL_BRANDING = {
    brand_name: 'Kincore',
    header_tagline: 'ACCOUNT NOTIFICATION',
    primary_color: '#FF622E',
    primary_color_dark: '#E04E1A',
    footer_note:
        'This is an automated account notification from the {{brand_name}} portal.'
};

const PLATFORM_KEY = 'email_branding';

export const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

const applyBrandTokens = (text, branding) =>
    String(text || '').replace(/\{\{brand_name\}\}/g, branding.brand_name || 'Kincore');

export const mergeEmailBranding = (stored = {}) => ({
    ...DEFAULT_EMAIL_BRANDING,
    ...(stored && typeof stored === 'object' ? stored : {})
});

export async function getEmailBranding() {
    try {
        const { data, error } = await supabase
            .from('platform_settings')
            .select('value')
            .eq('key', PLATFORM_KEY)
            .maybeSingle();
        if (error) console.warn('[EmailTemplateService] load branding:', error.message);
        return mergeEmailBranding(data?.value || {});
    } catch (err) {
        console.warn('[EmailTemplateService] load branding failed:', err.message);
        return mergeEmailBranding({});
    }
}

export async function saveEmailBranding(value, actorId = null) {
    const merged = mergeEmailBranding(value);
    const { error } = await supabase.from('platform_settings').upsert(
        {
            key: PLATFORM_KEY,
            value: merged,
            description: 'Global HTML email branding and footer copy',
            updated_at: new Date().toISOString()
        },
        { onConflict: 'key' }
    );
    if (error) throw error;

    if (actorId) {
        await supabase.from('audit_logs').insert({
            actor_id: actorId,
            action: 'EMAIL_BRANDING_UPDATED',
            target_type: 'platform_settings',
            target_id: PLATFORM_KEY,
            details: { keys: Object.keys(value || {}) }
        }).catch(() => {});
    }
    return merged;
}

/**
 * Kincore account-notification layout (replaces legacy plain / blue KCC-style emails).
 */
export function buildAccountNotificationEmail({
    title,
    intro,
    detailRows = [],
    bodyHtml = '',
    footerNote,
    branding = DEFAULT_EMAIL_BRANDING,
    cta
}) {
    const b = mergeEmailBranding(branding);
    const primary = b.primary_color || DEFAULT_EMAIL_BRANDING.primary_color;
    const footer = applyBrandTokens(footerNote || b.footer_note, b);

    const detailsBlock =
        detailRows.length > 0
            ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:24px auto 8px;">
        ${detailRows
            .map((row) => {
                const label = escapeHtml(row.label);
                const raw = row.value ?? '';
                const valueHtml = row.isEmail
                    ? `<a href="mailto:${escapeHtml(raw)}" style="color:${primary};text-decoration:underline;">${escapeHtml(raw)}</a>`
                    : escapeHtml(raw);
                return `<tr>
              <td style="padding:6px 12px;text-align:center;font-size:15px;color:#374151;">
                <strong style="color:#111827;">${label}:</strong> ${valueHtml}
              </td>
            </tr>`;
            })
            .join('')}
      </table>`
            : '';

    const ctaBlock = cta?.href
        ? `<p style="text-align:center;margin:28px 0 8px;">
        <a href="${escapeHtml(cta.href)}" style="display:inline-block;background:${primary};color:#ffffff;padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px;">
          ${escapeHtml(cta.label || 'Open')}
        </a>
      </p>`
        : '';

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <tr>
            <td style="background:${primary};border-radius:16px 16px 0 0;padding:28px 24px;text-align:center;">
              <div style="font-size:26px;font-weight:800;color:#ffffff;line-height:1.2;">${escapeHtml(b.brand_name)}</div>
              <div style="font-size:11px;letter-spacing:0.18em;color:rgba(255,255,255,0.92);margin-top:10px;font-weight:700;">${escapeHtml(b.header_tagline)}</div>
            </td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:32px 28px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;">
              <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;color:#111827;text-align:center;line-height:1.3;">${escapeHtml(title)}</h1>
              ${intro ? `<p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#4b5563;text-align:center;">${escapeHtml(intro)}</p>` : ''}
              ${detailsBlock}
              ${bodyHtml || ''}
              ${ctaBlock}
            </td>
          </tr>
          <tr>
            <td style="padding:22px 12px 8px;text-align:center;">
              <div style="display:inline-block;background:#FFE5DE;color:#9a3412;padding:12px 22px;border-radius:999px;font-size:12px;line-height:1.5;max-width:460px;">
                ${escapeHtml(footer)}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const textLines = [
        b.brand_name,
        b.header_tagline,
        '',
        title,
        intro || '',
        ...detailRows.map((r) => `${r.label}: ${r.value ?? ''}`),
        '',
        footer
    ].filter(Boolean);

    return { html, text: textLines.join('\n') };
}

export async function renderNotificationEmail(
    templateKey,
    { title, message, action, familyName, detailRows, policyOverrides = {} }
) {
    const branding = await getEmailBranding();
    const emailTitle = policyOverrides.email_subject || title || action;
    const intro =
        policyOverrides.email_intro ||
        message ||
        `You have a new notification regarding ${action}.`;

    const rows = Array.isArray(detailRows) && detailRows.length
        ? detailRows
        : familyName
          ? [{ label: 'Family space', value: familyName }]
          : [];

    const rendered = buildAccountNotificationEmail({
        title: emailTitle,
        intro,
        detailRows: rows,
        branding,
        footerNote: policyOverrides.email_footer || undefined
    });

    return {
        subject: emailTitle,
        html: rendered.html,
        text: rendered.text,
        templateKey: templateKey || 'default'
    };
}

export async function renderOtpEmail({ otp, firstName }) {
    const branding = await getEmailBranding();
    const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
    return buildAccountNotificationEmail({
        title: 'Verification code',
        intro: `${greeting} use this code to verify your Kincore account. It expires in 10 minutes.`,
        detailRows: [{ label: 'Code', value: otp }],
        branding,
        bodyHtml: `<p style="text-align:center;font-size:13px;color:#6b7280;margin-top:16px;">If you did not sign up for Kincore, you can ignore this email.</p>`
    });
}

export async function renderTreeInviteEmail({
    displayName,
    familyName,
    relationshipLabel,
    joinUrl,
    appBase
}) {
    const branding = await getEmailBranding();
    return buildAccountNotificationEmail({
        title: `Welcome to ${familyName}`,
        intro: `Hi ${displayName}, you were added as a ${relationshipLabel} on the ${familyName} family tree.`,
        detailRows: [
            { label: 'Family', value: familyName },
            { label: 'Relationship', value: relationshipLabel }
        ],
        branding,
        cta: { href: joinUrl, label: 'Open invite' },
        bodyHtml: `<p style="text-align:center;font-size:13px;color:#6b7280;margin-top:12px;">Or open the app: <a href="${escapeHtml(appBase)}" style="color:${branding.primary_color};">${escapeHtml(appBase)}</a></p>`
    });
}

export function buildSamplePreviewEmail(branding) {
    return buildAccountNotificationEmail({
        title: 'Nomination submitted',
        intro: 'A new nomination has been submitted and is waiting for review.',
        detailRows: [
            { label: 'Cause', value: 'Testing' },
            { label: 'Submitted by', value: 'SK Ker' },
            { label: 'Email', value: 'member@example.com', isEmail: true }
        ],
        branding: mergeEmailBranding(branding)
    });
}
