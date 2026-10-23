# Expérience accessible — revue du 24 octobre 2026, 10 h Montréal

Branche de préparation : `codex/accessible-delivery-experience`. Ne pas fusionner ni déployer avant la revue du propriétaire.

## Première préparation réalisée

- Choix français/espagnol conservé entre les six écrans principaux, avec solution de repli si le stockage est bloqué.
- Noms complets des langues, focus clavier visible, cases plus faciles à toucher, texte de saisie 16 px et respect de la préférence de réduction des animations.
- Vérification : les 49 tests existants passent. Inspection visuelle sur téléphone et zoom encore à réaliser.
- La branche comprend aussi le bouton de suppression manuelle de la branche `codex/manual-request-cleanup`, non déployé.

## Travail à terminer pour la revue

1. Demande en trois étapes : collecte, livraison, résumé et paiement. Retour sans perdre les données ; ne jamais accepter le prix ou les conditions automatiquement.
2. Français ou espagnol cohérent, textes simples, messages d'erreur utiles près du champ concerné, adresse enregistrée et consignes d'accès explicites.
3. Option sans pourboire, résumé avec adresses, tarif, taxes, pourboire, total et bouton de paiement affichant le montant.
4. Montrer/masquer le mot de passe, exigences visibles, aide permanente via serviceclient@toutaunclicla.com.
5. Livreur : action principale selon l'étape, appel du destinataire, signalement d'un problème, confirmation avant livraison et instructions de localisation.
6. Administration : sections demandes/livraisons/livreurs/clients/configuration, demandes payées non attribuées en priorité, suppression éloignée de l'attribution.
7. Contrôle téléphone étroit, zoom, clavier, contrastes et zones tactiles ; conserver toutes les protections serveur, règles tarifaires, taxes, conditions bilingues et webhook Stripe.

## Dépendances à vérifier séparément

- Autocomplétion : vérifier les API Google autorisées et la configuration avant toute nouvelle intégration payante.
- Courriels de devis et de paiement : résultat du diagnostic SMTP réel encore nécessaire ; les tests simulés ne prouvent pas la réception réelle.
- GPS en arrière-plan : la page actuelle doit rester ouverte ; une simple modification d'interface ne résout pas cette limite.
- Aucun paiement réel ou envoi de courriel réel de test dans cette préparation. Ne pas exposer les clés.

Présenter honnêtement ce qui fonctionne et ce qui reste à faire. La tâche planifiée reprend ces travaux ; elle ne garantit pas à elle seule leur achèvement.
