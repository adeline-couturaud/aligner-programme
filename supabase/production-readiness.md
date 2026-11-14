# Paiement réel : préparation avant ouverture

État : ventes fermées. Le paiement test à 37 € a été confirmé. Aucun paiement réel de bout en bout validé.

## Configuration restant à effectuer

1. Créer dans Stripe en production le tarif unique de 37 EUR et obtenir son identifiant price_. Le tarif de sandbox ne convient pas.
2. Configurer les secrets dans Supabase, hors conversation : STRIPE_LIVE_SECRET_KEY, STRIPE_LIVE_PRICE_ID, STRIPE_LIVE_WEBHOOK_SECRET. Conserver séparément les secrets de test existants.
3. Configurer dans Stripe production le webhook https://mzkuyhylnalkpismzmef.supabase.co/functions/v1/stripe-webhook pour checkout.session.completed et checkout.session.async_payment_succeeded.
4. Préparer le mail de confirmation et le parcours de retour dans le carnet. Vérifier les documents commerciaux et le traitement des remboursements avant ouverture.
5. Après décision explicite d’ouverture, passer LIVE_RELEASE_APPROVED à true dans les deux fonctions, déployer, définir CARNET_LIVE_SALES_ENABLED=true, puis ouvrir checkoutEnabled côté interface. Vérifier un premier paiement réel contrôlé et l’accès associé. Ne pas déclarer la production validée avant ce contrôle.

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
