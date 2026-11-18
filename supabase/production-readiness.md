# Paiement réel : préparation avant ouverture

État : ventes fermées. Le paiement test à 37 € a été confirmé. Aucun paiement réel de bout en bout validé.

## État vérifié au 18 novembre 2026

- Tarif de production de 37 EUR créé : price_1UboqaHM3OSYChuPVS1O1BQT.
- Contrôle administratrice réussi : clé de production au bon format, lecture du tarif exact, 37 EUR, paiement unique.
- Secret de signature configuré ; cela ne valide pas encore la signature d’un événement réel.
- Destination Stripe de production créée pour checkout.session.completed et checkout.session.async_payment_succeeded, vers https://mzkuyhylnalkpismzmef.supabase.co/functions/v1/stripe-webhook.
- Paiement de test confirmé le 16 novembre 2026 à 21:28 UTC. Aucun prélèvement réel et aucune activation d’accès par ce test.
- Email d’accès branché après activation réelle : version texte + HTML mobile, adresse confirmée du compte, expéditeur déjà utilisé par les notifications de contact.
- File privée créée atomiquement avec la commande et l’accès ; un message logique par session, tentatives tracées et protection contre les envois répétés.
- Tests simulés JavaScript, webhook signé et tests SQL annulés validés sans envoyer d’email. La réception réelle du nouvel email reste à vérifier.
- Parcours téléphone validé par l’administratrice : connexion, enregistrement, reprise et PDF. Le PDF utilise une génération locale, Montserrat intégrée et le partage de fichier.
- Lien du Cercle Aligné enregistré dans member_resources, protégé par les droits membres ; avertissement sur la visibilité des numéros avant adhésion.

## À finaliser avant ouverture

1. Vérifier la réception réelle du nouvel email sur une adresse de test explicitement autorisée, sans utiliser une vraie carte pour simuler un achat.
2. Vérifier les documents commerciaux remis à l’achat et le traitement des remboursements.
3. Après décision explicite d’ouverture, passer LIVE_RELEASE_APPROVED à true dans les deux fonctions, déployer, définir CARNET_LIVE_SALES_ENABLED=true, puis ouvrir checkoutEnabled côté interface. Contrôler la confirmation du premier achat client réel, l’accès associé et l’email.
4. Ne pas déclarer le paiement réel de bout en bout validé avant ce contrôle.

Les ventes restent fermées. Les bons cadeaux de colorimétrie constituent un produit distinct et ne doivent jamais activer un accès au carnet.

## Garanties du code préparé

- Double verrou serveur : constante de déploiement et variable d’environnement. L’interface reste également fermée.
- Vérification serveur du tarif, montant 3700 centimes, EUR, achat unique, mode test ou réel et consentements.
- Signature Stripe vérifiée puis relecture de la session et de sa ligne tarifaire auprès de Stripe.
- Paiement test : aucune activation ni écriture de commande réelle.
- Paiement réel : commande et accès écrits atomiquement dans activate_paid_enrollment, appelable uniquement par service_role.
- Réception répétée d’une même session : pas de doublon ni réactivation d’un accès retiré.
- Aucun traitement automatique de remboursement ajouté. Une révocation ultérieure ne doit pas être annulée par un ancien webhook.

## Vérification

node supabase/tests/live-payment/check.cjs

Les tests JavaScript simulent Stripe et Supabase, sans transfert d’argent. Les tests SQL supabase/tests/test_activate_paid_enrollment.sql créent des données synthétiques dans une transaction annulée. Ne pas exécuter les tests SQL hors transaction.

## Email d’accès : comportement et reprise

- L’email est enqueued dans private.paid_access_email_outbox par activate_paid_enrollment, après vérification de la commande et activation, dans la même transaction.
- stripe-webhook appelle sendPaidAccessEmail uniquement sur la branche réelle après cette transaction. Aucun email sur un paiement sandbox, des consentements absents ou une activation en échec.
- Le destinataire vient de auth.admin.getUserById et doit avoir une adresse confirmée. Le navigateur ne choisit jamais le destinataire.
- Le contenu complet est figé à la première tentative. Les tentatives suivantes utilisent ce même contenu et la même clé Resend carnet-access/<session>.
- Une réservation de 2 minutes empêche les tentatives simultanées. Un email déjà marqué sent ne peut plus être revendiqué.
- Une panne Resend ou une réponse invalide renvoie un échec au webhook pour que Stripe réessaie ; l’accès déjà activé reste actif.
- Les clés Resend ne sont conservées que 24 heures : https://resend.com/docs/dashboard/emails/idempotency-keys. Après 23 heures depuis la première tentative, une livraison incertaine passe à review et n’est plus renvoyée automatiquement. Contrôler le message côté Resend avant toute reprise manuelle.
- Si Stripe a épuisé ses tentatives, contrôler la file et reprendre un événement depuis Stripe après diagnostic. Aucun nouveau cron ni envoi massif n’a été ajouté.
- sent signifie accepté par Resend, pas preuve de réception en boîte de réception ; les rebonds restent à suivre chez le fournisseur.
- Un accès retiré ou une commande non paid bloque un email encore non envoyé. La réception répétée d’un ancien webhook ne réactive pas l’accès.
- Aucun email rétroactif n’est créé pour des commandes déjà traitées avant cette migration.
- Les tests SQL créent uniquement des fixtures dans une transaction annulée. La file réelle était vide après vérification.

Vérifications supplémentaires :
```
node supabase/tests/access-email.test.cjs
node supabase/tests/live-payment/check.cjs
```
Exécuter supabase/tests/test_paid_access_email.sql et supabase/tests/test_activate_paid_enrollment.sql en conservant BEGIN/ROLLBACK.
