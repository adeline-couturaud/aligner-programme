# Accès offerts au carnet

Les accès offerts sont réservés par adresse email dans `private.complimentary_access`.
Les adresses réelles restent exclusivement en base, jamais dans ce dépôt public.

La participante crée son compte habituel et confirme son email. Le trigger privé
`aligner_redeem_complimentary_access` utilise l'email confirmé de `auth.users`,
jamais les métadonnées modifiables par la participante, puis active son inscription.
Le rôle reste `member`. Aucun paiement ni date d'achat ne sont inventés.
Les règles de confidentialité et d'accès au contenu restent celles des membres.

Chaque réservation est utilisée une seule fois. Une mise à jour ultérieure du compte
ne réactive pas un accès révoqué. La suppression du compte n'efface pas la date
d'utilisation de la réservation. Toute nouvelle attribution doit être explicite.

Aucun email d'invitation n'est envoyé par cette opération.
Transmettre le lien habituel du carnet et indiquer « Créer un compte » avec l'adresse réservée.
Le courriel de confirmation suit le parcours d'inscription existant.
Le modèle d'email après achat reste réservé aux achats effectifs.

Le test SQL utilise des adresses fictives sous example.invalid et annule intégralement ses données.
