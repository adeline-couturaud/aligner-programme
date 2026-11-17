# Paiement réel : préparation avant ouverture

État : ventes fermées. Le paiement test à 37 € a été confirmé. Aucun paiement réel de bout en bout validé.

## État vérifié au 17 novembre 2026

- Tarif de production de 37 EUR créé : price_1UboqaHM3OSYChuPVS1O1BQT.
- Contrôle administratrice réussi : clé de production au bon format, lecture du tarif exact, 37 EUR, paiement unique.
- Secret de signature configuré ; cela ne valide pas encore la signature d’un événement réel.
- Destination Stripe de production créée pour checkout.session.completed et checkout.session.async_payment_succeeded, vers https://mzkuyhylnalkpismzmef.supabase.co/functions/v1/stripe-webhook.
- Paiement de test confirmé le 16 novembre 2026 à 21:28 UTC. Aucun prélèvement réel et aucune activation d’accès par ce test.
- Texte de l’email d’accès préparé dans emails/acces-apres-achat.md. L’envoi automatique n’est pas branché.

## À finaliser avant ouverture

1. Brancher l’email après activation réussie, avec protection contre les doublons et reprise d’un échec d’envoi. Aucun envoi autorisé par cette seule préparation.
2. Vérifier sur téléphone le parcours de connexion, le jour 1, l’enregistrement, la reprise au même compte et le bilan PDF.
3. Ajouter le lien privé du Cercle Aligné dans la ressource membres ; ne pas le publier dans la configuration publique.
4. Vérifier les documents commerciaux remis à l’achat et le traitement des remboursements.
5. Après décision explicite d’ouverture, passer LIVE_RELEASE_APPROVED à true dans les deux fonctions, déployer, définir CARNET_LIVE_SALES_ENABLED=true, puis ouvrir checkoutEnabled côté interface. Contrôler la confirmation du premier achat client réel et l’accès associé. Ne pas utiliser de carte réelle pour simuler un achat de test en production.
6. Ne pas déclarer le paiement réel de bout en bout validé avant ce contrôle.

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
