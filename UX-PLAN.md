# Expérience accessible — revue du 24 octobre 2026, 10 h Montréal

Branche de préparation : `codex/accessible-delivery-experience`. Ne pas fusionner ni déployer avant la revue du propriétaire.

## Version de revue terminée le 24 octobre 2026

Cette version est préparée dans GitHub pour revue uniquement. Production demeure sur la version avec le bouton bilingue « Articles interdits » (y compris le formulaire sans compte). Le texte juridique, les tarifs, les taxes et les secrets Stripe/SMTP ne sont pas modifiés par cette proposition.

### Demandeur

- Trois étapes avec validation de chaque étape : collecte, livraison, vérification/paiement. Les retours conservent les saisies ; modifier une adresse invalide le devis.
- Résumé des adresses, du destinataire et du colis ; prix, TPS, TVQ et pourboire visibles. Les détails distance/trafic restent consultables dans un volet.
- Bouton de paiement avec montant exact, option « Sans pourboire » explicite, prix et conditions jamais cochés automatiquement.
- Adresse de collecte du compte préremplie ; aucune ancienne adresse de destinataire n’est copiée. Instructions d’accès explicites.

### Tous les accès

- Langue français/espagnol mémorisée, boutons avec noms complets des langues, erreurs et aide localisées ; historique traduit dès le changement de langue.
- Montrer/masquer les mots de passe, exigences de longueur, erreurs près des champs, aide par serviceclient@toutaunclicla.com.
- Texte et contrôles plus lisibles, focus clavier, petites largeurs sans défilement horizontal. Contrôle de réduction des animations conservé.

### Livreur et administration

- Un itinéraire principal adapté à l’étape, appel du destinataire, signalement d’un problème et confirmation avant livraison définitive. Le regroupement de trois commandes est conservé.
- Guide d’autorisation de la position ; avertissement explicite que la page doit rester ouverte.
- Administration : navigation Demandes/Livraisons/Livreurs/Clients/Configuration ; demandes payées non attribuées en premier ; raccourci Clients vers la création du bon type de compte.
- La suppression manuelle préparé antérieurement reste inclus dans cette branche, hors production. Bouton destructif éloigné des contrôles d’attribution, confirmation et conservation du registre financier.

## Vérifications réalisées

- 49 tests Node réussis : autorisations, tarification, taxes, regroupement, acceptation, reprise des paiements, webhook, conservation, courriels simulés, suppression manuelle.
- Chromium réel, API entièrement simulées : parcours complet FR et ES ; erreurs requises et codes postaux ; retour sans perte ; modification après devis ; pourboire nul ; total avant Stripe ; aucune demande sans acceptation du prix et des conditions.
- Chromium : langue persistante, mot de passe visible/masqué, historique immédiatement traduit, collecte mémorisée, création de compte demandeur, priorité des demandes payées, téléphone du destinataire, annulation et confirmation de livraison.
- Contrôle de mise en page 375 px et reflow à 320 px, inspection visuelle des captures internes FR/ES. Le reflow à 320 px modélise une petite largeur/zoom ; aucun essai sur un téléphone physique ou lecteur d’écran n’a été réalisé. Il ne s’agit pas d’une certification d’accessibilité.
- Aucun appel réel à Stripe, Google ou SMTP, aucun paiement et aucun courriel de test envoyé.

Commande facultative de vérification navigateur : `PLAYWRIGHT_MODULE=/chemin/playwright/index.mjs CHROMIUM_PATH=/chemin/chrome node server/test/ui-browser-check.mjs`. Le test utilise un domaine de prévisualisation intercepté, pas le service de production.

## Préparation initiale (historique)

- Choix français/espagnol conservé entre les six écrans principaux, avec solution de repli si le stockage est bloqué.
- Noms complets des langues, focus clavier visible, cases plus faciles à toucher, texte de saisie 16 px et respect de la préférence de réduction des animations.
- Vérification : les 49 tests existants passent. Inspection visuelle sur téléphone et zoom encore à réaliser.
- La branche comprend aussi le bouton de suppression manuelle de la branche `codex/manual-request-cleanup`, non déployé.

## Périmètre demandé (réalisé sauf dépendances ci-dessous)

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
