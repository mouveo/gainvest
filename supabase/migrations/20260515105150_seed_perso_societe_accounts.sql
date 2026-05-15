-- Renomme l'unique "Portefeuille" historique en "Perso" puis ajoute un compte
-- "Société Mouveo" pour chaque utilisateur qui n'en a pas encore. Idempotent.

UPDATE public.accounts
SET name = 'Perso'
WHERE name = 'Portefeuille';

INSERT INTO public.accounts (user_id, name, type, broker, currency)
SELECT u.id, 'Société Mouveo', 'cto', 'Bourse Direct', 'EUR'
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1
  FROM public.accounts a
  WHERE a.user_id = u.id
    AND a.name = 'Société Mouveo'
);
