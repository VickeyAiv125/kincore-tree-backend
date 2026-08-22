/**
 * PlenorHub /checkout/shipping-rates currently validates:
 *   shipping_address.name, address, city, state, zip
 * Docs still show recipient_name / postal_code. Send both.
 */
export const normalizePlenorShippingAddress = (raw = {}) => {
    const name = String(
        raw.name || raw.recipient_name || raw.recipientName || raw.full_name || ''
    ).trim();
    const address = String(
        raw.address || raw.line1 || raw.street || raw.address_line_1 || ''
    ).trim();
    const city = String(raw.city || '').trim();
    const state = String(raw.state || raw.province || raw.region || '').trim();
    const zip = String(
        raw.zip || raw.postal_code || raw.postalCode || raw.postcode || ''
    ).trim();
    const phone = String(
        raw.phone || raw.recipient_phone || raw.recipientPhone || ''
    ).trim();
    const country = String(raw.country || raw.country_code || 'MY').trim();

    return {
        name,
        address,
        city,
        state,
        zip,
        recipient_name: name,
        recipient_phone: phone || undefined,
        postal_code: zip,
        country
    };
};

export const assertPlenorShippingAddress = (addr) => {
    const missing = [];
    if (!addr.name) missing.push('shipping_address.name');
    if (!addr.address) missing.push('shipping_address.address');
    if (!addr.city) missing.push('shipping_address.city');
    if (!addr.state) missing.push('shipping_address.state');
    if (!addr.zip) missing.push('shipping_address.zip');
    return missing;
};
