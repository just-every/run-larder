// What `rer export` writes and `rer import` restores for a local installation.
// Migration 0013 seeds larder_meta in every migrated database, including the
// empty one `rer reset` leaves, so restore replaces that row instead of
// refusing the destination as not empty.
export const portabilityPolicy = {
 includeTables: ['oa_operators','oa_bootstrap','oa_external_identities','oa_invitation_cancellations','oa_tokens','oa_auth_settings','oa_auth_audit','oa_domain_rules','oa_logout_events','oc_owner_claims','oc_idp_grants'],
 excludeTables: ['rer_dependency_keys','rer_dependency_pending','rer_dependency_codes'],
 replaceableTables: ['larder_meta'],
 product: 'runeditrun/foundation',
 requiredConfiguration: ['OWNER_EMAIL', 'SESSION_SECRET', 'SETUP_TOKEN', 'AUTH_ORIGIN', 'MAIL_PROVIDER', 'MAIL_FROM'],
};
