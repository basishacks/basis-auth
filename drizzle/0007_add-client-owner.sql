UPDATE "oidc_clients"
SET "metadata" = jsonb_set(
	"metadata" - 'ownerId',
	'{owners}',
	'[{"id":"c6ba1588-03bb-4c61-a4e1-3c7c82e919b5","role":"role.ADMIN"}]'::jsonb,
	true
);
