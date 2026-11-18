# Email d’accès après achat

Statut au 18 novembre 2026 : envoi automatique branché après activation réelle, ventes toujours fermées. Tests simulés et SQL validés ; aucun nouvel email envoyé. Réception réelle du message encore à vérifier.

Objet : Votre Carnet Aligné est prêt

Bonjour,

Votre achat est confirmé. Votre accès à Mon Carnet Aligné est activé.

[Ouvrir mon carnet](https://adeline-couturaud.github.io/aligner-programme/)

Connectez-vous avec le compte utilisé pour votre achat. Si vous avez oublié votre mot de passe, cliquez sur « Mot de passe oublié ? ».

Pour commencer : ouvrez le jour 1, « Point de départ ». Vous pourrez avancer à votre rythme et retrouver vos réponses en vous reconnectant au même compte.

Sur téléphone, vous pouvez ajouter le carnet à votre écran d’accueil pour le retrouver facilement. Une connexion internet reste nécessaire.

Une difficulté d’accès ? Écrivez-moi à contact@alignerconseil.fr en précisant l’adresse email de votre compte.

Adeline
Aligner Conseil

---

## Conditions de branchement

- Envoyer uniquement après paiement réel vérifié et activation de l’accès réussie. Jamais au simple retour depuis Stripe.
- Destinataire : adresse vérifiée du compte associé à l’achat, lue côté serveur.
- Un seul email logique par commande. Utiliser une clé d’idempotence liée à la session Stripe et un mécanisme de reprise des échecs.
- Une erreur d’envoi ne doit pas retirer l’accès ni provoquer une seconde commande.
- Ne pas envoyer cet email pour un paiement de test ou un autre produit Stripe, notamment les bons cadeaux.
- Ne pas ajouter la cliente à une newsletter sans consentement distinct.
- Ne pas inclure de mot de passe, de jeton de connexion ou de lien WhatsApp public.
- Valider l’expéditeur et la réception avant activation des envois.
- Ne pas confondre cet email d’accès avec le reçu de paiement ou les documents contractuels à remettre sur support durable.
