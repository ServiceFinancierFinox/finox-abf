/**
 * ═══════════════════════════════════════════════════════════════
 * FINOX CRM - Navigation & Chargement de Modules
 * ═══════════════════════════════════════════════════════════════
 * Gère:
 * - Chargement dynamique des modules (fetch + injection)
 * - Auto-save avant navigation
 * - État actif du menu
 * - Accordéons (volets)
 * - Historique de navigation (browser back/forward)
 *
 * Mode production: désactive les logs de debug sur crm.finox.ca
 */

(function() {
    'use strict';

    // Mode production
    const IS_PRODUCTION = window.location.hostname === 'crm.finox.ca';

    // Logger conditionnel
    const log = {
        debug: (...args) => { if (!IS_PRODUCTION) console.log(...args); },
        warn: (...args) => { if (!IS_PRODUCTION) console.warn(...args); },
        error: (...args) => console.error(...args)
    };

    // ==========================================
    // VARIABLES
    // ==========================================
    let currentModule = null;
    let hasUnsavedChanges = false;
    let navSystemInitialized = false;
    let lastABFModule = null;      // Dernier module ABF visité (pour reprendre)
    let lastCorpoModule = null;    // Dernier module corpo visité

    // ==========================================
    // ABF STEPPER — Définition des étapes
    // ==========================================
    const ABF_STEPS = [
        { module: 'abf-contact',            label: 'Contact',            icon: '📇', category: 'INFORMATIONS',  checkKey: 'contact' },
        { module: 'abf-adresse',            label: 'Adresse & Dates',    icon: '📍', category: 'INFORMATIONS',  checkKey: 'adresse' },
        { module: 'abf-emploi',             label: 'Emploi & Revenus',   icon: '💼', category: 'INFORMATIONS',  checkKey: 'emploi' },
        { module: 'abf-actifs',             label: 'Portrait Financier', icon: '💰', category: 'FINANCES',      checkKey: 'actifs' },
        { module: 'abf-assurances',         label: 'Assurances',         icon: '🛡️', category: 'FINANCES',      checkKey: 'assurances' },
        { module: 'abf-besoins-vie',        label: 'Assurance Vie',      icon: '❤️', category: 'BESOINS',       checkKey: 'besoins-vie' },
        { module: 'abf-besoins-invalidite', label: 'Invalidité',         icon: '🦽', category: 'BESOINS',       checkKey: 'besoins-invalidite' },
        { module: 'abf-besoins-mg',         label: 'Maladies Graves',    icon: '🏥', category: 'BESOINS',       checkKey: 'besoins-mg' },
        { module: 'abf-retraite',           label: 'Retraite',           icon: '🏖️', category: 'PLANIFICATION', checkKey: 'retraite' },
        { module: 'conformite-recommandations', label: 'Recommandations', icon: '✅', category: 'PLANIFICATION', checkKey: 'conformite' },
        { module: 'abf-objectifs',          label: 'Opportunités',       icon: '🎯', category: 'PLANIFICATION', checkKey: 'objectifs' },
        { module: 'conformite-lettre',          label: 'Lettre Explicative', icon: '✉️', category: 'CONFORMITÉ', checkKey: 'lettre' },
        { module: 'conformite-export',          label: 'Exporter PDF',       icon: '📥', category: 'CONFORMITÉ', checkKey: 'export' },
    ];

    const CORPO_STEPS = [
        { module: 'abf-corpo-profil',       label: 'Informations',       icon: '📋', category: 'PROFIL',     checkKey: 'corpo-profil' },
        { module: 'abf-corpo-societe',      label: 'Société par actions',icon: '🏦', category: 'PROFIL',     checkKey: 'corpo-societe' },
        { module: 'abf-corpo-personnes',    label: 'Personnes clés',     icon: '👔', category: 'PERSONNES',  checkKey: 'corpo-personnes' },
        { module: 'abf-corpo-actionnaires', label: 'Actionnaires',       icon: '📊', category: 'PERSONNES',  checkKey: 'corpo-actionnaires' },
        { module: 'abf-corpo-assurances',   label: 'Assurances',         icon: '🏥', category: 'ASSURANCES', checkKey: 'corpo-assurances' },
        { module: 'abf-corpo-objectifs',    label: 'Objectifs',          icon: '✅', category: 'ANALYSE',    checkKey: 'corpo-objectifs' },
        { module: 'abf-corpo-analyses',     label: 'Analyses',           icon: '📈', category: 'ANALYSE',    checkKey: 'corpo-analyses' },
        { module: 'abf-corpo-finances',     label: 'Bilan financier',    icon: '💼', category: 'FINANCES',   checkKey: 'corpo-finances' },
    ];

    const ABF_ALL_MODULES = new Set([...ABF_STEPS, ...CORPO_STEPS].map(s => s.module));

    // ==========================================
    // MODULE HELP — Textes d'aide par module
    // ==========================================
    const MODULE_HELP = {
        'abf-contact': {
            title: '📇 Fiche Contact',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>La fiche contact est la base de tout dossier client. C'est ici que vous saisissez les informations personnelles du client, de son conjoint et de ses enfants.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Client :</strong> Nom, prénom, date de naissance, sexe, statut fumeur, état civil, testament</li>
                    <li><strong>Conjoint :</strong> Activer la section conjoint pour un dossier couple — les calculs de besoins s'ajusteront automatiquement</li>
                    <li><strong>Enfants :</strong> Ajouter des enfants à charge — utilisés dans les calculs de besoins et la planification</li>
                    <li><strong>Type de contact :</strong> Choisir entre Client, Prospect ou Lead pour adapter le suivi</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Les données saisies ici alimentent automatiquement tous les autres modules : calculs d'assurance vie, invalidité, retraite, impôts au décès, etc. Une fiche bien remplie = des analyses précises.</p>
                <div class="help-tip"><strong>Astuce :</strong> Le statut fumeur et la date de naissance sont essentiels pour les calculs de primes. Le testament influence les recommandations et peut créer une opportunité automatique.</div>
            `
        },
        'abf-adresse': {
            title: '📍 Adresse & Dates',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Saisie de l'adresse de résidence et des dates clés du dossier (anniversaires, renouvellements, etc.).</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Adresse :</strong> Recherche Google intégrée — commencez à taper et sélectionnez pour auto-remplir</li>
                    <li><strong>Dates importantes :</strong> Anniversaire de police, date de renouvellement hypothécaire, dates de renouvellement auto/habitation</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Les dates de renouvellement créent automatiquement des opportunités et des rappels dans votre pipeline. L'adresse est utilisée pour la conformité et les lettres explicatives.</p>
                <div class="help-tip"><strong>Astuce :</strong> Remplissez les dates de renouvellement pour ne jamais manquer une opportunité de contact avec votre client.</div>
            `
        },
        'abf-emploi': {
            title: '💼 Emploi & Revenus',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Portrait complet de la situation d'emploi et de toutes les sources de revenus du client et du conjoint.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Emplois multiples :</strong> Ajouter plusieurs emplois avec salaire, avantages sociaux, régime collectif</li>
                    <li><strong>Sources de revenus :</strong> Revenus locatifs, dividendes, pensions, RQAP, etc.</li>
                    <li><strong>Fréquence :</strong> Basculer entre affichage annuel et mensuel</li>
                    <li><strong>Calcul fiscal :</strong> Estimation automatique de l'impôt provincial et fédéral (Québec)</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Le revenu est la base des calculs de besoins en invalidité, en assurance vie et en planification de retraite. Les avantages sociaux déterminent les lacunes de couverture à combler.</p>
                <div class="help-tip"><strong>Astuce :</strong> Indiquez si le client a un régime collectif — cela change radicalement les recommandations d'assurance.</div>
            `
        },
        'abf-actifs': {
            title: '💰 Portrait Financier',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Vue complète du patrimoine : actifs, passifs, pensions et projections financières du client.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Actifs :</strong> REER, CELI, REEE, comptes non-enregistrés, immobilier, véhicules</li>
                    <li><strong>Passifs :</strong> Hypothèque, prêts auto, marges de crédit, cartes de crédit</li>
                    <li><strong>Pensions :</strong> RRQ/RPC, PSV, régimes de pension agréés</li>
                    <li><strong>Valeur nette :</strong> Calcul automatique actifs − passifs</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Le portrait financier alimente directement les calculs de besoins en assurance vie (dettes à couvrir au décès), la planification de retraite et les impôts au décès (gains en capital).</p>
                <div class="help-tip"><strong>Astuce :</strong> Les dettes inscrites ici apparaissent automatiquement dans le calcul des besoins en assurance vie comme montant à couvrir au décès.</div>
            `
        },
        'abf-assurances': {
            title: '🛡️ Assurances en Vigueur',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Inventaire complet de toutes les polices d'assurance existantes du client et du conjoint.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Ajouter des polices :</strong> Vie, invalidité, maladies graves, collective — via un formulaire en 2 étapes</li>
                    <li><strong>Détails par police :</strong> Assureur, numéro de police, primes, montants de couverture, bénéficiaires</li>
                    <li><strong>Vue d'ensemble :</strong> Total des couvertures par type pour identifier rapidement les lacunes</li>
                    <li><strong>Modifier/Supprimer :</strong> Cliquer sur une police pour l'éditer ou la retirer</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Les couvertures existantes sont soustraites automatiquement des besoins calculés. Sans cette section, les recommandations ne tiendraient pas compte de ce que le client possède déjà.</p>
                <div class="help-tip"><strong>Astuce :</strong> Pensez à inclure les assurances collectives — elles réduisent souvent significativement les besoins individuels à combler.</div>
            `
        },
        'abf-besoins-vie': {
            title: '❤️ Besoins en Assurance Vie',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Calculateur des besoins en assurance vie basé sur la méthode du capital nécessaire. Analyse combien de couverture il faudrait au décès du client ou du conjoint.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Besoins au décès :</strong> Dettes, frais funéraires, fonds d'urgence, revenu de remplacement pour le survivant</li>
                    <li><strong>Couverture enfants :</strong> Frais d'éducation, garde, activités</li>
                    <li><strong>Impôts au décès :</strong> Intégration automatique du calcul de gain en capital</li>
                    <li><strong>Couvertures existantes :</strong> Déduction automatique des polices en vigueur</li>
                    <li><strong>Résultat :</strong> Besoin net = Total des besoins − Actifs disponibles − Couvertures existantes</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>C'est le cœur de l'analyse des besoins financiers. Le résultat détermine le montant d'assurance vie à recommander et justifie votre recommandation auprès du client et de l'AMF.</p>
                <div class="help-tip"><strong>Astuce :</strong> Le calcul utilise automatiquement les données des modules précédents (revenus, dettes, assurances existantes). Plus votre ABF est complet, plus l'analyse est précise.</div>
            `
        },
        'abf-besoins-invalidite': {
            title: '🦽 Besoins en Invalidité',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Calcul du revenu mensuel nécessaire en cas d'invalidité du client ou du conjoint.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Dépenses mensuelles :</strong> Habitation, transport, alimentation, dettes fixes</li>
                    <li><strong>Sources de remplacement :</strong> RQAP, assurance collective, épargne accessible</li>
                    <li><strong>Délai de carence :</strong> Période d'attente avant le début des prestations</li>
                    <li><strong>Résultat :</strong> Déficit mensuel à combler par une assurance individuelle</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>L'invalidité est le risque le plus sous-estimé. Un client a plus de chances de devenir invalide que de décéder avant 65 ans. Cette analyse montre concrètement le manque à gagner.</p>
                <div class="help-tip"><strong>Astuce :</strong> N'oubliez pas d'inclure le régime collectif de l'employeur s'il y en a un — il couvre souvent une partie du revenu.</div>
            `
        },
        'abf-besoins-mg': {
            title: '🏥 Besoins en Maladies Graves',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Estimation du montant forfaitaire nécessaire en cas de diagnostic d'une maladie grave (cancer, AVC, crise cardiaque, etc.).</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Coûts directs :</strong> Traitements non couverts par la RAMQ, médicaments, soins à domicile</li>
                    <li><strong>Coûts indirects :</strong> Perte de revenu pendant la convalescence, adaptation du domicile</li>
                    <li><strong>Impact familial :</strong> Congé du conjoint aidant, frais de garde supplémentaires</li>
                    <li><strong>Résultat :</strong> Montant forfaitaire recommandé</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Contrairement à l'invalidité (revenu mensuel), l'assurance maladies graves verse un montant unique au diagnostic. C'est un coussin financier pour traverser la crise sans s'endetter.</p>
                <div class="help-tip"><strong>Astuce :</strong> 1 Canadien sur 2 recevra un diagnostic de cancer au cours de sa vie. Ce calcul aide à convaincre les clients hésitants avec des chiffres concrets.</div>
            `
        },
        'abf-retraite': {
            title: '🏖️ Planification Retraite',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Simulateur complet de retraite intégré à l'ABF. Projette les revenus, les épargnes et le décaissement jusqu'à la fin de vie.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Paramètres :</strong> Âge de retraite souhaité, espérance de vie, taux de rendement, inflation</li>
                    <li><strong>Sources de revenus :</strong> RRQ/RPC (estimé automatiquement), PSV, pension employeur, épargnes</li>
                    <li><strong>Projection :</strong> Graphique année par année montrant revenus vs dépenses</li>
                    <li><strong>Revenu viable :</strong> Calcul du revenu maximum soutenable sans épuiser le capital</li>
                    <li><strong>Surplus/Déficit :</strong> Identification des années où l'épargne s'épuise</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>La retraite est la préoccupation #1 des clients. Ce module utilise les données déjà saisies (revenus, actifs, pensions) pour projeter leur avenir financier réaliste.</p>
                <div class="help-tip"><strong>Astuce :</strong> Les données sont auto-mappées depuis les modules Emploi et Actifs. Ajustez les rendements et l'inflation pour montrer différents scénarios au client.</div>
            `
        },
        'abf-objectifs': {
            title: '🎯 Opportunités & Références',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Gestion des opportunités de vente, suivi des références et objectifs du plan d'action pour ce client.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Opportunités :</strong> Créer et suivre des opportunités (renouvellements, cross-sell, placements, assurances, etc.)</li>
                    <li><strong>Références :</strong> Ajouter des personnes référées par le client avec coordonnées et suivi de conversion</li>
                    <li><strong>Relances :</strong> Système de suivi avec backoff automatique (1j → 3j → 7j → 14j → 30j)</li>
                    <li><strong>Objectifs client :</strong> Checklist des objectifs discutés lors de l'ABF (protection, optimisation, planification)</li>
                    <li><strong>Notes :</strong> Recommandations et notes personnalisées par opportunité</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>C'est ici que l'ABF se transforme en actions concrètes. Chaque besoin identifié devient une opportunité traçable avec des dates et des rappels.</p>
                <div class="help-tip"><strong>Astuce :</strong> Les opportunités créées ici apparaissent aussi dans le module Opportunités global pour une vue d'ensemble de toute votre clientèle.</div>
            `
        },
        'abf-impots-deces': {
            title: '💀 Impôts au Décès',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Calculateur des impôts à payer au décès suite à la disposition présumée des actifs (gain en capital).</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Actifs imposables :</strong> REER/FERR, placements non-enregistrés, immobilier (hors résidence principale)</li>
                    <li><strong>Gain en capital :</strong> Différence entre valeur marchande et coût d'acquisition</li>
                    <li><strong>Taux d'inclusion :</strong> 50% du gain en capital ajouté au revenu</li>
                    <li><strong>Résultat :</strong> Estimation de la facture fiscale à prévoir</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Au décès, le fisc considère que tous les actifs sont vendus. Ce montant s'ajoute aux besoins en assurance vie et surprend souvent les clients. C'est un argument de vente puissant.</p>
                <div class="help-tip"><strong>Astuce :</strong> Ce calcul est automatiquement intégré dans les besoins en assurance vie. Plus les actifs sont importants, plus la facture fiscale justifie une couverture.</div>
            `
        },
        'abf-projets-epargne': {
            title: '📊 Projets d\'Épargne',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Planification et simulation de projets d'épargne spécifiques (REEE, mise de fonds, fonds d'urgence, etc.).</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Types de projets :</strong> REEE, achat immobilier, fonds d'urgence, objectif personnalisé</li>
                    <li><strong>Simulation :</strong> Montant cible, horizon de temps, cotisations requises</li>
                    <li><strong>Scénarios :</strong> Comparer différents montants et durées</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Permet de montrer au client un plan concret pour atteindre ses objectifs d'épargne, avec des cotisations réalistes basées sur son budget.</p>
                <div class="help-tip"><strong>Astuce :</strong> Utilisez le formulaire en 2 étapes pour guider le client — sélectionnez d'abord le type de projet, puis les détails.</div>
            `
        },
        'conformite-recommandations': {
            title: '✅ Recommandations',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Résumé structuré de tous les besoins identifiés et des décisions prises par le client, le conjoint et pour les enfants.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Onglet Assurance :</strong> Résumé des besoins vie, invalidité, maladies graves — avec les décisions client (accepte, refuse, reporte)</li>
                    <li><strong>Onglet Épargne :</strong> Résumé des recommandations d'épargne et placements</li>
                    <li><strong>Objectifs par produit :</strong> Lien entre les besoins et les produits recommandés</li>
                    <li><strong>Opportunités à faire :</strong> Liste des actions concrètes à poser suite à l'ABF</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Ce module est essentiel pour la conformité AMF. Il documente que vous avez présenté des recommandations et que le client a pris des décisions éclairées.</p>
                <div class="help-tip"><strong>Astuce :</strong> Documentez toujours les refus du client — c'est votre protection en cas de plainte.</div>
            `
        },
        'conformite-lettre': {
            title: '✉️ Lettre Explicative',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Génération de la lettre explicative AMF — document obligatoire qui résume l'analyse et les recommandations au client.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Génération IA :</strong> Claude génère automatiquement la lettre à partir de toutes les données de l'ABF</li>
                    <li><strong>Personnalisation :</strong> Modifier le contenu généré pour l'adapter à votre style</li>
                    <li><strong>Historique :</strong> Conserver toutes les versions précédentes de la lettre</li>
                    <li><strong>Export :</strong> Copier ou exporter pour envoi au client</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>La lettre explicative est une exigence réglementaire de l'AMF. Elle protège le conseiller et informe le client de manière transparente sur les recommandations et leur justification.</p>
                <div class="help-tip"><strong>Astuce :</strong> Plus votre ABF est complet, meilleure sera la lettre générée par l'IA. Relisez toujours avant d'envoyer au client.</div>
            `
        },
        'conformite-export': {
            title: '📥 Exporter PDF',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Export du dossier ABF complet en PDF pour archivage, envoi au client ou signature électronique.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Sélection des sections :</strong> Choisir quelles parties de l'ABF inclure dans le PDF</li>
                    <li><strong>Aperçu :</strong> Visualiser le document avant export</li>
                    <li><strong>Signature électronique :</strong> Envoi via DocuSign pour signature à distance</li>
                    <li><strong>Archivage :</strong> Conserver une copie datée du dossier complet</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Le PDF signé est votre preuve de conformité. Il documente l'analyse complète et la décision du client à un moment précis dans le temps.</p>
                <div class="help-tip"><strong>Astuce :</strong> Exportez un PDF à chaque révision annuelle pour garder un historique complet du dossier.</div>
            `
        },
        // ── CORPO ──
        'abf-corpo-profil': {
            title: '📋 Profil Entreprise',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Informations de base de l'entreprise cliente : identité légale, secteur d'activité, coordonnées.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Identité :</strong> Nom légal, NEQ (numéro d'entreprise), date de constitution</li>
                    <li><strong>REQ :</strong> Recherche automatique au Registraire des entreprises du Québec pour auto-remplir</li>
                    <li><strong>Industrie :</strong> Secteur d'activité, nombre d'employés, chiffre d'affaires</li>
                    <li><strong>Coordonnées :</strong> Adresse du siège social, téléphone, courriel</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Le profil entreprise est la fondation du dossier corporatif. Le secteur d'activité et la taille de l'entreprise influencent les recommandations d'assurance et les produits offerts.</p>
            `
        },
        'abf-corpo-societe': {
            title: '🏦 Société par Actions',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Informations corporatives détaillées : structure juridique, convention entre actionnaires, fiscalité.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Structure :</strong> Type de société, juridiction, date de constitution</li>
                    <li><strong>Convention :</strong> Convention entre actionnaires, clauses de rachat, droits de premier refus</li>
                    <li><strong>Fiscalité :</strong> Année financière, compte de dividende en capital (CDC)</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>La convention entre actionnaires détermine les besoins en assurance personne clé et en rachat de parts. Sans ces informations, les recommandations corporatives sont incomplètes.</p>
            `
        },
        'abf-corpo-personnes': {
            title: '👔 Personnes Clés',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Gestion des personnes clés de l'entreprise : dirigeants, employés essentiels dont l'absence aurait un impact financier majeur.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Identifier :</strong> Les personnes dont le décès ou l'invalidité mettrait l'entreprise en difficulté</li>
                    <li><strong>Évaluer :</strong> L'impact financier de la perte de chaque personne clé</li>
                    <li><strong>Rôles :</strong> Président, VP, directeur des ventes, développeur senior, etc.</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>L'assurance personne clé protège l'entreprise contre la perte soudaine d'un individu essentiel. C'est un produit souvent méconnu mais très pertinent pour les PME.</p>
            `
        },
        'abf-corpo-actionnaires': {
            title: '📊 Actionnaires',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Registre des actionnaires, répartition des parts et planification du rachat de parts.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Parts :</strong> Répartition du capital-actions entre les actionnaires</li>
                    <li><strong>Évaluation :</strong> Valeur des parts de chaque actionnaire</li>
                    <li><strong>Rachat :</strong> Mécanisme de rachat en cas de décès, invalidité ou départ</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Le rachat de parts entre actionnaires au décès est le besoin #1 en assurance corporative. Cette section calcule le montant exact d'assurance nécessaire pour financer le rachat.</p>
            `
        },
        'abf-corpo-assurances': {
            title: '🏥 Assurances Corporatives',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Inventaire des polices d'assurance existantes détenues par l'entreprise.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Polices :</strong> Vie, invalidité, maladies graves détenues par la société</li>
                    <li><strong>Détails :</strong> Assureur, montants, primes payées par la société</li>
                    <li><strong>Bénéficiaires :</strong> Société vs actionnaires vs héritiers</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Les couvertures existantes sont soustraites des besoins corporatifs. Permet aussi de vérifier si les bénéficiaires sont correctement désignés selon la convention.</p>
            `
        },
        'abf-corpo-objectifs': {
            title: '✅ Objectifs Corporatifs',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Checklist des objectifs d'assurance corporative : besoins en vie et en maladies graves identifiés pour l'entreprise.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Objectifs Vie :</strong> Rachat de parts, personne clé, dette corporative, obligations contractuelles</li>
                    <li><strong>Objectifs MG :</strong> Protection de l'entreprise en cas de maladie grave d'un dirigeant</li>
                    <li><strong>Priorisation :</strong> Classer les objectifs par ordre d'importance avec le client</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Cette checklist structure la discussion avec le client et s'assure qu'aucun besoin n'est oublié. Les objectifs cochés alimentent les analyses détaillées.</p>
            `
        },
        'abf-corpo-analyses': {
            title: '📈 Analyses Corporatives',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Formulaires détaillés de calcul par objectif d'assurance corporative, avec résultats automatiques.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Calculs détaillés :</strong> Un formulaire par objectif identifié (rachat de parts, personne clé, etc.)</li>
                    <li><strong>Automatisation :</strong> Les données des actionnaires et personnes clés sont pré-remplies</li>
                    <li><strong>Résultats :</strong> Montant de couverture recommandé par objectif</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>Ces analyses justifient chaque recommandation avec des calculs précis. C'est la preuve que vos recommandations sont fondées sur une analyse rigoureuse.</p>
            `
        },
        'abf-corpo-finances': {
            title: '💼 Bilan Financier',
            body: `
                <h4>Qu'est-ce que cette page?</h4>
                <p>Portrait financier de l'entreprise : bilan, résultats, ratios et indicateurs clés.</p>
                <h4>Ce que vous pouvez y faire</h4>
                <ul>
                    <li><strong>Bilan :</strong> Actifs et passifs de l'entreprise</li>
                    <li><strong>Résultats :</strong> Revenus, dépenses, bénéfice net</li>
                    <li><strong>Ratios :</strong> Rentabilité, liquidité, endettement</li>
                    <li><strong>Évaluation :</strong> Estimation de la valeur de l'entreprise</li>
                </ul>
                <h4>Pourquoi c'est important?</h4>
                <p>La santé financière de l'entreprise détermine sa capacité à payer des primes et la valeur des parts à racheter. C'est aussi un indicateur de la pérennité de l'entreprise.</p>
            `
        }
    };

    // ── INJECTION DU BOUTON D'AIDE ──
    function injectHelpButton(moduleName) {
        // Nettoyer l'ancien bouton/overlay
        document.getElementById('moduleHelpBtn')?.remove();
        document.getElementById('moduleHelpOverlay')?.remove();

        const help = MODULE_HELP[moduleName];
        if (!help) return;

        // Bouton ?
        const btn = document.createElement('button');
        btn.id = 'moduleHelpBtn';
        btn.className = 'module-help-btn';
        btn.textContent = '?';
        btn.title = 'Aide sur cette page';
        btn.onclick = () => {
            document.getElementById('moduleHelpOverlay')?.classList.add('active');
        };
        document.body.appendChild(btn);

        // Overlay
        const overlay = document.createElement('div');
        overlay.id = 'moduleHelpOverlay';
        overlay.className = 'module-help-overlay';
        overlay.innerHTML = `
            <div class="module-help-popup">
                <div class="module-help-popup-header">
                    <h3>${help.title}</h3>
                    <div class="module-help-popup-close" onclick="document.getElementById('moduleHelpOverlay').classList.remove('active')">✕</div>
                </div>
                <div class="module-help-popup-body">${help.body}</div>
            </div>
        `;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
        document.body.appendChild(overlay);

        // Escape pour fermer
        const escHandler = (e) => {
            if (e.key === 'Escape' && overlay.classList.contains('active')) {
                overlay.classList.remove('active');
            }
        };
        document.addEventListener('keydown', escHandler);
        if (window.FINOX?.registerCleanup) FINOX.registerCleanup(() => document.removeEventListener('keydown', escHandler));
    }

    // (Conformité stepper supprimé — les 3 modules sont dans ABF_STEPS, Documents et Préavis dans la sidebar)

    // ==========================================
    // GESTION STEPPER — Définition des étapes
    // ==========================================
    const GESTION_STEPS = [
        { module: 'mes-assurances',   label: 'Assurances',    icon: '🛡️', category: 'PORTEFEUILLE', checkKey: 'gest-assurances' },
        { module: 'mes-placements',   label: 'Placements',    icon: '📈', category: 'PORTEFEUILLE', checkKey: 'gest-placements' },
    ];

    const GEST_ALL_MODULES = new Set(GESTION_STEPS.map(s => s.module));
    let lastGestModule = null;  // Dernier module gestion visité

    // Config DOM IDs pour le stepper Gestion
    const GEST_STEPPER_CONFIG = {
        catsId: 'gestStepperCats',
        prevId: 'gestPrev',
        nextId: 'gestNext',
        stepperId: 'gestionStepper',
        goFn: 'gestStepperGo',
        celebrationMsg: '🎉 Affaires 100% complétées !',
    };

    // Champs obligatoires par module — warning toast si vides au départ
    const ABF_REQUIRED_FIELDS = {
        'abf-contact': [
            { id: 'clientPrenom', label: 'Prénom' },
            { id: 'clientNom', label: 'Nom' },
            { id: 'clientDOB', label: 'Date de naissance' },
            { id: 'clientSex', label: 'Sexe' },
        ],
        'abf-adresse': [
            { id: 'city', label: 'Ville' },
            { id: 'postalCode', label: 'Code postal' },
        ],
        'abf-emploi': [
            { id: 'typeEmploiClient', label: "Type d'emploi" },
        ],
    };

    // Helper: map de complétion réutilisable
    function getCompletionMap(abfData) {
        return {
            'contact': abfData.section_contact_completed === true,
            'adresse': abfData.section_adresse_completed === true,
            'emploi': abfData.section_emploi_completed === true,
            'actifs': abfData.section_actifs_completed === true,
            'assurances': abfData.section_assurances_completed === true,
            'besoins-vie': abfData.section_vie_completed === true,
            'besoins-invalidite': abfData.section_invalidite_completed === true,
            'besoins-mg': abfData.section_mg_completed === true,
            'objectifs': abfData.section_objectifs_completed === true,
            'retraite': abfData.section_retraite_completed === true,
            'corpo-profil': abfData.section_corpo_profil_completed === true,
            'corpo-societe': abfData.section_corpo_societe_completed === true,
            'corpo-personnes': abfData.section_corpo_personnes_completed === true,
            'corpo-actionnaires': abfData.section_corpo_actionnaires_completed === true,
            'corpo-assurances': abfData.section_corpo_assurances_completed === true,
            'corpo-objectifs': abfData.section_corpo_objectifs_completed === true,
            'corpo-analyses': abfData.section_corpo_analyses_completed === true,
            'corpo-finances': abfData.section_corpo_finances_completed === true,
            // Conformité
            'conformite': abfData.section_conformite_completed === true,
            'lettre': abfData.section_lettre_completed === true,
            'export': abfData.section_export_completed === true,
            'preavis': abfData.section_preavis_completed === true,
            // Gestion
            'gest-assurances': abfData.section_gest_assurances_completed === true,
            'gest-placements': abfData.section_gest_placements_completed === true,
            'gest-documents': abfData.section_gest_documents_completed === true,
        };
    }

    // Helper: mapper checkKey → clé DB dans abf_data
    function getCompletionDbKey(checkKey) {
        const map = {
            'contact': 'section_contact_completed',
            'adresse': 'section_adresse_completed',
            'emploi': 'section_emploi_completed',
            'actifs': 'section_actifs_completed',
            'assurances': 'section_assurances_completed',
            'besoins-vie': 'section_vie_completed',
            'besoins-invalidite': 'section_invalidite_completed',
            'besoins-mg': 'section_mg_completed',
            'objectifs': 'section_objectifs_completed',
            'retraite': 'section_retraite_completed',
            'corpo-profil': 'section_corpo_profil_completed',
            'corpo-societe': 'section_corpo_societe_completed',
            'corpo-personnes': 'section_corpo_personnes_completed',
            'corpo-actionnaires': 'section_corpo_actionnaires_completed',
            'corpo-assurances': 'section_corpo_assurances_completed',
            'corpo-objectifs': 'section_corpo_objectifs_completed',
            'corpo-analyses': 'section_corpo_analyses_completed',
            'corpo-finances': 'section_corpo_finances_completed',
            'conformite': 'section_conformite_completed',
            'lettre': 'section_lettre_completed',
            'export': 'section_export_completed',
            'preavis': 'section_preavis_completed',
            'gest-assurances': 'section_gest_assurances_completed',
            'gest-placements': 'section_gest_placements_completed',
            'gest-documents': 'section_gest_documents_completed',
        };
        return map[checkKey] || null;
    }

    // Auto-complétion: marquer une section comme complétée après sauvegarde réussie
    async function autoMarkCompleted(moduleName) {
        const allSteps = [...ABF_STEPS, ...CORPO_STEPS, ...GESTION_STEPS];
        const step = allSteps.find(s => s.module === moduleName);
        if (!step) return;

        const completionKey = getCompletionDbKey(step.checkKey);
        if (!completionKey) return;

        // Vérifier si déjà complété
        const client = FINOX.getClientData();
        const abfData = client?.abf_data || {};
        if (abfData[completionKey] === true) return;

        // Sauvegarder en DB
        const updatedAbfData = { ...abfData, [completionKey]: true };
        try {
            await FINOX.supabase.from('clients')
                .update({ abf_data: updatedAbfData })
                .eq('id', FINOX.CLIENT_ID);
            await FINOX.loadClientData(true);
            log.debug('[Nav] Auto-complété:', moduleName);
        } catch (err) {
            log.error('[Nav] Erreur auto-complétion:', err.message);
        }
    }

    // Vérifier les champs manquants avant navigation
    function checkMissingFields(moduleName) {
        const fields = ABF_REQUIRED_FIELDS[moduleName];
        if (!fields || fields.length === 0) return null;

        const missing = [];
        for (const f of fields) {
            const el = document.getElementById(f.id);
            if (!el) continue;
            const val = el.value?.trim();
            if (!val || val === '') missing.push(f.label);
        }
        if (missing.length === 0) return null;

        const step = [...ABF_STEPS, ...CORPO_STEPS, ...GESTION_STEPS].find(s => s.module === moduleName);
        return { sectionName: step ? step.label : moduleName, missing };
    }

    // Vérifier si toutes les sections d'un track sont complètes (célébration)
    function checkAllDoneCelebration(steps, stepperId, celebrationMsg) {
        const client = FINOX.getClientData?.();
        const abfData = client?.abf_data || {};
        const map = getCompletionMap(abfData);
        const allDone = steps.every(s => map[s.checkKey]);
        const stepper = document.getElementById(stepperId);
        if (stepper) {
            if (allDone && !stepper.classList.contains('all-done')) {
                stepper.classList.add('all-done');
                FINOX.showNotification(celebrationMsg, 'success');
            } else if (!allDone) {
                stepper.classList.remove('all-done');
            }
        }
    }

    function isABFModule(moduleName) {
        return ABF_ALL_MODULES.has(moduleName);
    }

    function isCorpoModule(moduleName) {
        return CORPO_STEPS.some(s => s.module === moduleName);
    }


    function isGestionModule(moduleName) {
        return GEST_ALL_MODULES.has(moduleName);
    }

    function getActiveSteps() {
        const client = FINOX.getClientData?.();
        if (client?.type_contact === 'corpo') return CORPO_STEPS;
        return ABF_STEPS;
    }

    // ==========================================
    // ABF STEPPER — Rendu et interactions
    // ==========================================
    function renderStepper(steps, activeModule, config = {}) {
        const {
            catsId = 'abfStepperCats',
            prevId = 'abfPrev',
            nextId = 'abfNext',
            goFn = 'abfStepperGo',
        } = config;

        // Déterminer les fonctions prev/next à appeler
        const prevFn = prevId === 'gestPrev' ? 'gestStepperPrev' : 'abfStepperPrev';
        const nextFn = prevId === 'gestPrev' ? 'gestStepperNext' : 'abfStepperNext';

        const catsEl = document.getElementById(catsId);
        if (!catsEl) return;

        const client = FINOX.getClientData?.();
        const abfData = client?.abf_data || {};
        const completionMap = getCompletionMap(abfData);

        const activeIdx = steps.findIndex(s => s.module === activeModule);
        const activeCategory = activeIdx >= 0 ? steps[activeIdx].category : '';

        // Also track category label positions
        const catGroups = [];
        let currentGroup = null;
        let lastCategory = null;

        // ── 1. Labels de catégorie AU-DESSUS ──
        // Pre-scan pour construire catGroups
        steps.forEach((step) => {
            if (step.category !== lastCategory) {
                currentGroup = { name: step.category, count: 0, isActive: step.category === activeCategory };
                catGroups.push(currentGroup);
            }
            currentGroup.count++;
            lastCategory = step.category;
        });

        const arrowW = 52; // largeur flèche (36px) + margin (8*2)
        let labelsHtml = `<div class="abf-track-labels" style="padding-left:${arrowW}px; padding-right:${arrowW}px;">`;
        catGroups.forEach((grp, gi) => {
            if (gi > 0) labelsHtml += '<div style="width:26px;flex-shrink:0;"></div>'; // separator (2px + 12*2 margin)
            const nodeW = 48; const connW = 28;
            const w = grp.count * nodeW + (grp.count - 1) * connW;
            labelsHtml += `<div class="abf-track-label${grp.isActive ? ' active' : ''}" style="width:${w}px;flex-shrink:0;">${grp.name}</div>`;
        });
        labelsHtml += '</div>';

        // ── 2. Track avec flèches intégrées ──
        const prevSvg = '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>';
        const nextSvg = '<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>';

        let trackHtml = '<div class="abf-track">';
        // Flèche gauche
        trackHtml += `<button class="abf-nav-arrow" id="${prevId}" onclick="${prevFn}()" title="Précédent"${activeIdx === 0 ? ' disabled' : ''}>${prevSvg}</button>`;

        lastCategory = null;
        steps.forEach((step, i) => {
            const isDone = completionMap[step.checkKey] || false;
            const isActive = step.module === activeModule;

            if (step.category !== lastCategory) {
                if (lastCategory !== null) {
                    trackHtml += '<div class="abf-separator"></div>';
                }
            }

            if (i > 0 && step.category === lastCategory) {
                const prevDone = completionMap[steps[i - 1].checkKey] || false;
                let connCls = 'abf-connector';
                if (prevDone && isDone) connCls += ' done';
                else if (prevDone && !isDone) connCls += ' partial';
                else connCls += ' todo';
                trackHtml += `<div class="${connCls}"></div>`;
            }

            let nodeCls = 'abf-node';
            if (isDone) nodeCls += ' done';
            if (isActive) nodeCls += ' active';
            // Mark retraite as optional/dimmed when not enabled
            if (step.module === 'abf-retraite' && !abfData.retraite_enabled) nodeCls += ' optional';
            trackHtml += `<div class="${nodeCls}" data-module="${step.module}" data-check="${step.checkKey}" onclick="${goFn}('${step.module}')">`;
            trackHtml += step.icon;
            trackHtml += `<span class="abf-node-tip">${step.label}</span>`;
            trackHtml += '</div>';

            lastCategory = step.category;
        });

        // Flèche droite
        trackHtml += `<button class="abf-nav-arrow" id="${nextId}" onclick="${nextFn}()" title="Suivant"${activeIdx === steps.length - 1 ? ' disabled' : ''}>${nextSvg}</button>`;

        trackHtml += '</div>';

        catsEl.innerHTML = labelsHtml + trackHtml;

        // Scroll active node into view
        requestAnimationFrame(() => {
            const activeNode = catsEl.querySelector('.abf-node.active');
            if (activeNode) activeNode.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        });
    }

    // Navigation stepper — check champs manquants + auto-save + navigation
    async function navigateWithSaveAndCheck(targetModule) {
        if (!targetModule || targetModule === currentModule) return;

        // 1. Vérifier champs manquants AVANT save (DOM encore là)
        const warning = checkMissingFields(currentModule);

        // 2. Auto-save
        if (typeof window.saveModuleData === 'function') {
            await saveCurrentModule();
        }

        // 3. Toast warning non-bloquant si champs manquants
        if (warning) {
            const list = warning.missing.join(', ');
            FINOX.showNotification(
                `⚠️ ${warning.sectionName}: ${list} manquant${warning.missing.length > 1 ? 's' : ''}`,
                'warning'
            );
        }

        // 4. Naviguer (skip auto-save car déjà fait ci-dessus)
        loadModule(targetModule, true, true);
    }

    window.abfStepperGo = function(moduleName) {
        navigateWithSaveAndCheck(moduleName);
    };

    window.abfStepperPrev = function() {
        const steps = getActiveSteps();
        const idx = steps.findIndex(s => s.module === currentModule);
        if (idx > 0) navigateWithSaveAndCheck(steps[idx - 1].module);
    };

    window.abfStepperNext = function() {
        const steps = getActiveSteps();
        const idx = steps.findIndex(s => s.module === currentModule);
        if (idx < steps.length - 1) navigateWithSaveAndCheck(steps[idx + 1].module);
    };


    // ==========================================
    // GESTION STEPPER — Navigation
    // ==========================================
    window.gestStepperGo = function(moduleName) {
        navigateWithSaveAndCheck(moduleName);
    };

    window.gestStepperPrev = function() {
        const idx = GESTION_STEPS.findIndex(s => s.module === currentModule);
        if (idx > 0) navigateWithSaveAndCheck(GESTION_STEPS[idx - 1].module);
    };

    window.gestStepperNext = function() {
        const idx = GESTION_STEPS.findIndex(s => s.module === currentModule);
        if (idx < GESTION_STEPS.length - 1) navigateWithSaveAndCheck(GESTION_STEPS[idx + 1].module);
    };

    // Keyboard navigation (← → quand un stepper est actif et pas dans un input)
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const abfStepper = document.getElementById('abfStepper');
        const gestStepper = document.getElementById('gestionStepper');
        const abfActive = abfStepper?.classList.contains('active');
        const gestActive = gestStepper?.classList.contains('active');
        if (!abfActive && !gestActive) return;
        const tag = document.activeElement?.tagName?.toLowerCase();
        if (['input', 'textarea', 'select'].includes(tag)) return;
        e.preventDefault();
        if (gestActive) {
            if (e.key === 'ArrowLeft') window.gestStepperPrev();
            else window.gestStepperNext();
        } else {
            if (e.key === 'ArrowLeft') window.abfStepperPrev();
            else window.abfStepperNext();
        }
    });

    // ==========================================
    // GESTION DES CHANGEMENTS NON SAUVEGARDÉS
    // ==========================================
    function markAsUnsaved() {
        hasUnsavedChanges = true;
        updateSaveIndicator(false);
    }

    function markAsSaved() {
        hasUnsavedChanges = false;
        updateSaveIndicator(true);
    }

    function updateSaveIndicator(isSaved) {
        const indicator = document.getElementById('saveStatusIndicator');

        if (indicator) {
            if (isSaved) {
                indicator.classList.remove('unsaved');
            } else {
                indicator.classList.add('unsaved');
            }
        }
    }

    // ==========================================
    // SAUVEGARDE DU MODULE ACTUEL
    // ==========================================
    async function saveCurrentModule() {
        if (typeof window.saveModuleData === 'function') {
            try {
                console.log('[Nav] 💾 Auto-save module:', currentModule);
                const result = await window.saveModuleData();

                if (result && result.success) {
                    markAsSaved();
                    // ★ Auto-complétion: marquer la section comme complétée
                    await autoMarkCompleted(currentModule);
                    console.log('[Nav] ✅ Module sauvegardé:', currentModule);
                    return true;
                } else {
                    console.warn('[Nav] ⚠️ Erreur sauvegarde:', result?.error);
                    return false;
                }
            } catch (err) {
                console.error('[Nav] ❌ Erreur sauvegarde module:', err.message);
                return false;
            }
        } else {
            console.log('[Nav] ℹ️ Pas de saveModuleData pour:', currentModule);
        }
        return true;
    }

    // ==========================================
    // SAUVEGARDE MANUELLE (bouton)
    // ==========================================
    async function manualSave() {
        const saveBtn = document.getElementById('manualSaveBtn');
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<span class="spinner-small"></span>';
        }

        const success = await saveCurrentModule();

        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = 'save';
        }

        if (success) {
            FINOX.showNotification('Enregistré', 'success');
        } else {
            FINOX.showNotification('Erreur de sauvegarde', 'error');
        }
    }

    // ==========================================
    // CHARGEMENT DE MODULE
    // ==========================================
    async function loadModule(moduleName, addToHistory = true, skipAutoSave = false) {
        const contentArea = document.getElementById('module-content');

        // ── Protection: ne pas naviguer si un modal/overlay est ouvert ──
        const openModals = document.querySelectorAll(
            '[class*="overlay"].active, [class*="overlay"].show, [class*="Overlay"].active, [class*="Overlay"].show, ' +
            '[class*="modal-overlay"].active, [class*="modal-overlay"].show, ' +
            '.ins-modal-overlay.show, .assurance-modal-overlay.active'
        );
        if (openModals.length > 0 && moduleName !== currentModule) {
            console.warn('[Nav] ⚠️ Navigation bloquée — un modal est ouvert. Fermez-le d\'abord.');
            return;
        }

        // Auto-save du module précédent avant navigation
        // Skip si navigateWithSaveAndCheck l'a déjà fait
        if (!skipAutoSave && currentModule && currentModule !== moduleName && typeof window.saveModuleData === 'function') {
            console.log('[Nav] Auto-save avant navigation:', currentModule, '->', moduleName);
            await saveCurrentModule();
        }

        // Invalider le cache de requêtes pour que le prochain module lise des données fraîches
        if (window.FINOX && FINOX.invalidateCache) {
            FINOX.invalidateCache();
        }

        // Nettoyer les ressources du module précédent (intervals, timeouts, listeners)
        if (window.FINOX && FINOX.cleanupModuleResources) {
            FINOX.cleanupModuleResources();
        }
        window.saveModuleData = null;
        window.getModuleData = null;
        hasUnsavedChanges = false;

        // Afficher le loading
        contentArea.innerHTML = `
            <div class="module-loading">
                <div class="spinner"></div>
                <span>Chargement...</span>
            </div>
        `;

        try {
            const response = await fetch(`modules/${moduleName}.html?v=${Date.now()}`);

            if (!response.ok) {
                throw new Error(`Module "${moduleName}" non trouvé`);
            }

            const html = await response.text();
            contentArea.innerHTML = html;
            executeModuleScripts(contentArea);
            // Init custom selects après injection du module
            if (typeof window.initCustomSelects === 'function') {
                setTimeout(() => window.initCustomSelects(contentArea), 150);
            }
            updateActiveNav(moduleName);

            // ABF Stepper — afficher/masquer + render
            const stepper = document.getElementById('abfStepper');
            if (stepper) {
                if (isABFModule(moduleName)) {
                    stepper.classList.add('active');
                    renderStepper(isCorpoModule(moduleName) ? CORPO_STEPS : getActiveSteps(), moduleName);
                    // Mémoriser le dernier module visité
                    if (isCorpoModule(moduleName)) lastCorpoModule = moduleName;
                    else lastABFModule = moduleName;
                } else {
                    stepper.classList.remove('active');
                }
            }

            // Gestion Stepper — afficher/masquer + render
            const gestStepper = document.getElementById('gestionStepper');
            if (gestStepper) {
                if (isGestionModule(moduleName)) {
                    gestStepper.classList.add('active');
                    renderStepper(GESTION_STEPS, moduleName, GEST_STEPPER_CONFIG);
                    lastGestModule = moduleName;
                } else {
                    gestStepper.classList.remove('active');
                }
            }

            if (addToHistory) {
                const clientId = FINOX.getClientId();
                const url = clientId
                    ? `?client=${clientId}&module=${moduleName}`
                    : `?module=${moduleName}`;
                // replaceState so browser back goes to client list, not previous module
                history.replaceState({ module: moduleName }, '', url);
            }

            currentModule = moduleName;
            markAsSaved();

            // Injecter le bouton d'aide (?) si le module a un texte d'aide
            injectHelpButton(moduleName);

            log.debug('[Nav] Module chargé:', moduleName);

            if (typeof window.FINOX_NAV?.updateABFCheckmarks === 'function') {
                window.FINOX_NAV.updateABFCheckmarks();
            }
            if (isGestionModule(moduleName) && typeof updateGestionCheckmarks === 'function') {
                updateGestionCheckmarks();
            }

        } catch (err) {
            log.error('[Nav] Erreur chargement module:', err.message);
            contentArea.innerHTML = `
                <div class="module-loading">
                    <div style="font-size: 48px; margin-bottom: 16px;">X</div>
                    <span style="color: var(--danger);">Erreur: ${err.message}</span>
                    <button class="btn btn-secondary" style="margin-top: 20px;" onclick="loadModule('dashboard')">
                        Retour au Dashboard
                    </button>
                </div>
            `;
        }
    }

    // ==========================================
    // EXÉCUTION DES SCRIPTS DU MODULE
    // ==========================================
    function executeModuleScripts(container) {
        const scripts = container.querySelectorAll('script');

        scripts.forEach(oldScript => {
            const newScript = document.createElement('script');

            Array.from(oldScript.attributes).forEach(attr => {
                newScript.setAttribute(attr.name, attr.value);
            });

            if (oldScript.textContent && !oldScript.src) {
                newScript.textContent = `(function(){"use strict";${oldScript.textContent}})();`;
            } else {
                newScript.textContent = oldScript.textContent;
            }

            oldScript.parentNode.replaceChild(newScript, oldScript);
        });
    }

    // ==========================================
    // MISE À JOUR DU MENU ACTIF
    // ==========================================
    function updateActiveNav(moduleName) {
        document.querySelectorAll('.nav-item').forEach(item => {
            item.classList.remove('active');
        });

        // ABF modules → highlight the single ABF/Corpo nav-item in sidebar
        if (isABFModule(moduleName)) {
            const navId = isCorpoModule(moduleName) ? 'navCorpo' : 'navABF';
            const navEl = document.getElementById(navId);
            if (navEl) navEl.classList.add('active');
            return;
        }

        // Gestion modules → highlight the single Gestion nav-item
        if (isGestionModule(moduleName)) {
            const navEl = document.getElementById('navGestion');
            if (navEl) navEl.classList.add('active');
            return;
        }

        const activeItem = document.querySelector(`.nav-item[data-module="${moduleName}"]`);
        if (activeItem) {
            activeItem.classList.add('active');

            const parentVolet = activeItem.closest('.nav-volet');
            if (parentVolet) {
                parentVolet.classList.add('open');
            }
        }
    }

    // ==========================================
    // GESTION DES VOLETS (ACCORDÉONS)
    // ==========================================
    function toggleVolet(voletElement) {
        const isCurrentlyOpen = voletElement.classList.contains('open');

        document.querySelectorAll('.nav-volet').forEach(v => {
            v.classList.remove('open');
        });

        if (!isCurrentlyOpen) {
            voletElement.classList.add('open');
        }
    }

    function initVolets() {
        document.querySelectorAll('.nav-volet-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const volet = header.closest('.nav-volet');
                toggleVolet(volet);
            });
        });
    }

    // ==========================================
    // NAVIGATION PAR CLIC
    // ==========================================
    function initNavigation() {
        // ABF nav-item — charge le dernier module visité ou le premier
        const navABF = document.getElementById('navABF');
        if (navABF) {
            navABF.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.nav-volet').forEach(v => v.classList.remove('open'));
                loadModule(lastABFModule || 'abf-contact');
            });
        }

        // Corpo nav-item — idem
        const navCorpo = document.getElementById('navCorpo');
        if (navCorpo) {
            navCorpo.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.nav-volet').forEach(v => v.classList.remove('open'));
                loadModule(lastCorpoModule || 'abf-corpo-profil');
            });
        }

        // Gestion nav-item — charge le dernier module visité ou le premier
        const navGest = document.getElementById('navGestion');
        if (navGest) {
            navGest.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.nav-volet').forEach(v => v.classList.remove('open'));
                loadModule(lastGestModule || 'mes-assurances');
            });
        }

        // Tous les autres nav-items (avec data-module)
        document.querySelectorAll('.nav-item[data-module]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const moduleName = item.dataset.module;

                const parentVolet = item.closest('.nav-volet');
                if (!parentVolet) {
                    document.querySelectorAll('.nav-volet').forEach(v => {
                        v.classList.remove('open');
                    });
                }

                loadModule(moduleName);
            });
        });
    }

    // ==========================================
    // GESTION HISTORIQUE (BACK/FORWARD)
    // ==========================================
    function initHistoryHandler() {
        window.addEventListener('popstate', async (e) => {
            if (e.state && e.state.module) {
                if (hasUnsavedChanges) {
                    await saveCurrentModule();
                }
                loadModule(e.state.module, false);
            }
        });
    }

    // ==========================================
    // AVERTISSEMENT AVANT FERMETURE PAGE
    // ==========================================
    function initBeforeUnload() {
        window.addEventListener('beforeunload', (e) => {
            if (hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = 'Vous avez des modifications non enregistrées. Voulez-vous vraiment quitter?';
                return e.returnValue;
            }
        });
    }

    // ==========================================
    // CHARGEMENT INITIAL
    // ==========================================
    function getInitialModule() {
        const params = new URLSearchParams(window.location.search);
        return params.get('module') || 'abf-contact';
    }

    // ==========================================
    // MISE À JOUR INFOS CLIENT DANS SIDEBAR
    // ==========================================
    async function updateSidebarClientInfo() {
        const clientData = await FINOX.loadClientData();

        if (clientData) {
            const fullName = `${clientData.first_name || ''} ${clientData.last_name || ''}`.trim();

            const nameEl = document.getElementById('sidebarClientName');
            if (nameEl) {
                nameEl.textContent = fullName || 'Client';
            }

            document.title = `${fullName} - Finox CRM`;

            // Switch volet ABF ↔ Corpo selon le type de contact
            toggleCorpoMode(clientData);
        }
    }

    // ==========================================
    // SWITCH ABF INDIVIDUEL ↔ ABF CORPO
    // ==========================================
    function toggleCorpoMode(clientData) {
        const isCorpo = clientData?.type_contact === 'corpo';

        // ABF nav items (plus de volets, ce sont des nav-items simples)
        const navABF = document.getElementById('navABF');
        const navCorpo = document.getElementById('navCorpo');
        if (navABF) navABF.style.display = isCorpo ? 'none' : '';
        if (navCorpo) navCorpo.style.display = isCorpo ? '' : 'none';

        // Outils: cacher les personnels en corpo, montrer les corpo-only
        document.querySelectorAll('[data-corpo-hide]').forEach(el => {
            el.style.display = isCorpo ? 'none' : '';
        });
        document.querySelectorAll('[data-corpo-only]').forEach(el => {
            el.style.display = isCorpo ? '' : 'none';
        });
    }

    // ==========================================
    // MISE À JOUR INFOS CONSEILLER
    // ==========================================
    function updateSidebarUserInfo() {
        const user = FINOX.getCurrentUser();
        const profile = FINOX.getUserProfile ? FINOX.getUserProfile() : null;
        const providerName = user?.user_metadata?.full_name || user?.user_metadata?.name;
        const providerPhoto = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

        // Nom: priorite au profil Supabase (first_name + last_name), puis provider, puis email
        const name = profile?.first_name
            ? `${profile.first_name} ${profile.last_name || ''}`.trim()
            : providerName || (user ? user.email.split('@')[0] : 'Conseiller');

        const nameEl = document.getElementById('sidebarUserName');
        if (nameEl) {
            nameEl.textContent = name;
        }

        const avatarEl = document.getElementById('sidebarUserAvatar');
        if (avatarEl) {
            const esc = FINOX.escapeHtml || (s => s);
            if (profile?.photo_url) {
                avatarEl.innerHTML = `<img src="${esc(profile.photo_url)}" alt="${esc(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
            } else if (providerPhoto) {
                avatarEl.innerHTML = `<img src="${esc(providerPhoto)}" alt="${esc(name)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">`;
            } else {
                avatarEl.textContent = name.charAt(0).toUpperCase();
            }
        }
    }

    // ==========================================
    // SIDEBAR MOBILE
    // ==========================================
    function toggleSidebar() {
        const sidebar = document.querySelector('.sidebar');
        sidebar.classList.toggle('open');
    }

    function initMobileSidebar() {
        document.querySelectorAll('.nav-item[data-module]').forEach(item => {
            item.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    document.querySelector('.sidebar').classList.remove('open');
                }
            });
        });
    }

    // ==========================================
    // MISE À JOUR DU BADGE ASSURANCES
    // ==========================================
    async function updateAssurancesBadge() {
        const badge = document.getElementById('assurancesBadge');
        if (!badge) return;

        if (!FINOX.CLIENT_ID || !FINOX.supabase) {
            badge.textContent = '0';
            return;
        }

        try {
            const { count, error } = await FINOX.supabase
                .from('assurances_vendues')
                .select('*', { count: 'exact', head: true })
                .eq('client_id', FINOX.CLIENT_ID);

            if (error) throw error;
            badge.textContent = count || 0;

            if (count > 0) {
                badge.style.background = 'rgba(139, 92, 246, 0.3)';
                badge.style.color = '#a78bfa';
            } else {
                badge.style.background = '';
                badge.style.color = '';
            }
        } catch (badgeErr) {
            log.error('[Nav] Erreur badge assurances:', badgeErr.message);
            badge.textContent = '0';
        }
    }

    // ==========================================
    // MISE À JOUR DU BADGE PLACEMENTS
    // ==========================================
    async function updatePlacementsBadge() {
        const badge = document.getElementById('placementsBadge');
        if (!badge) return;

        if (!FINOX.CLIENT_ID || !FINOX.supabase) {
            badge.textContent = '0';
            return;
        }

        try {
            const { count, error } = await FINOX.supabase
                .from('placements')
                .select('*', { count: 'exact', head: true })
                .eq('client_id', FINOX.CLIENT_ID);

            if (error) throw error;
            badge.textContent = count || 0;

            if (count > 0) {
                badge.style.background = 'rgba(16, 185, 129, 0.3)';
                badge.style.color = '#34d399';
            } else {
                badge.style.background = '';
                badge.style.color = '';
            }
        } catch (badgeErr) {
            log.error('[Nav] Erreur badge placements:', badgeErr.message);
            badge.textContent = '0';
        }
    }

    // ==========================================
    // MISE À JOUR DU BADGE AFFAIRES (combiné)
    // ==========================================
    async function updateAffairesBadge() {
        const badge = document.getElementById('affairesBadge');
        if (!badge) return;

        if (!FINOX.CLIENT_ID || !FINOX.supabase) {
            badge.style.display = 'none';
            return;
        }

        try {
            const [assRes, plRes] = await Promise.all([
                FINOX.supabase.from('assurances_vendues').select('*', { count: 'exact', head: true }).eq('client_id', FINOX.CLIENT_ID),
                FINOX.supabase.from('placements').select('*', { count: 'exact', head: true }).eq('client_id', FINOX.CLIENT_ID)
            ]);

            const total = (assRes.count || 0) + (plRes.count || 0);

            if (total > 0) {
                badge.textContent = total;
                badge.style.display = 'inline-flex';
                badge.style.background = 'rgba(129, 140, 248, 0.3)';
                badge.style.color = '#a78bfa';
            } else {
                badge.style.display = 'none';
            }
        } catch (err) {
            log.error('[Nav] Erreur badge affaires:', err.message);
            badge.style.display = 'none';
        }
    }

    // ==========================================
    // MISE À JOUR DU BADGE DOCUMENTS
    // ==========================================
    async function updateDocumentsBadge() {
        const badge = document.getElementById('documentsBadge');
        if (!badge) return;

        if (!FINOX.CLIENT_ID || !FINOX.supabase) {
            badge.style.display = 'none';
            return;
        }

        try {
            // Count pending exchanges (more important than total docs)
            const { count: exchangeCount, error } = await FINOX.supabase
                .from('document_exchanges')
                .select('*', { count: 'exact', head: true })
                .eq('client_id', FINOX.CLIENT_ID)
                .in('status', ['pending', 'viewed', 'partial']);

            if (error) throw error;

            if (exchangeCount > 0) {
                badge.textContent = exchangeCount;
                badge.style.display = 'inline-flex';
                badge.style.background = 'rgba(245, 158, 11, 0.3)';
                badge.style.color = '#f59e0b';
            } else {
                // Show total doc count
                const { count: docCount } = await FINOX.supabase
                    .from('client_documents')
                    .select('*', { count: 'exact', head: true })
                    .eq('client_id', FINOX.CLIENT_ID)
                    .eq('is_archived', false);

                if (docCount > 0) {
                    badge.textContent = docCount;
                    badge.style.display = 'inline-flex';
                    badge.style.background = 'rgba(59, 130, 246, 0.3)';
                    badge.style.color = '#60a5fa';
                } else {
                    badge.style.display = 'none';
                }
            }
        } catch (badgeErr) {
            log.error('[Nav] Erreur badge documents:', badgeErr.message);
            badge.style.display = 'none';
        }
    }

    // ==========================================
    // MISE À JOUR DU BADGE OPPORTUNITÉS
    // ==========================================
    async function updateOppBadge() {
        const badge = document.getElementById('oppBadge');
        if (!badge) return;

        if (!FINOX.CLIENT_ID || !FINOX.supabase) {
            badge.style.display = 'none';
            return;
        }

        try {
            const ACTIVE_STAGES = ['active', 'identified', 'qualified', 'action_planned', 'in_progress', 'proposal_sent'];
            const { count, error } = await FINOX.supabase
                .from('client_opportunities')
                .select('*', { count: 'exact', head: true })
                .eq('client_id', FINOX.CLIENT_ID)
                .in('stage', ACTIVE_STAGES);

            if (error) throw error;

            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        } catch (badgeErr) {
            log.error('[Nav] Erreur badge opportunités:', badgeErr.message);
            badge.style.display = 'none';
        }
    }

    // ==========================================
    // MISE À JOUR DES CHECKMARKS ABF
    // ==========================================
    async function updateABFCheckmarks() {
        const client = FINOX.getClientData();
        if (!client) return;

        const abfData = client.abf_data || {};
        const sections = getCompletionMap(abfData);

        // --- ABF Individuel ---
        const personalKeys = getActiveSteps().map(s => s.checkKey);
        let completedCount = 0;
        const totalSections = personalKeys.length;

        personalKeys.forEach(checkId => {
            const isComplete = sections[checkId] || false;
            const dotEl = document.querySelector(`.abf-node[data-check="${checkId}"]`);
            if (dotEl) {
                const wasDone = dotEl.classList.contains('done');
                if (isComplete) {
                    dotEl.classList.add('done');
                    if (!wasDone) {
                        dotEl.classList.add('just-completed');
                        setTimeout(() => dotEl.classList.remove('just-completed'), 500);
                    }
                    completedCount++;
                } else {
                    dotEl.classList.remove('done');
                }
            } else if (isComplete) {
                completedCount++;
            }
        });

        // Barre ABF individuel
        const progressBar = document.getElementById('abfProgressBar');
        const progressText = document.getElementById('abfProgressText');

        if (progressBar && progressText) {
            const percentage = Math.round((completedCount / totalSections) * 100);
            progressBar.style.width = `${percentage}%`;
            progressText.textContent = `${percentage}%`;

            if (percentage >= 100) {
                progressBar.style.background = 'linear-gradient(90deg, #10b981, #059669)';
            } else if (percentage >= 50) {
                progressBar.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
            } else {
                progressBar.style.background = 'linear-gradient(90deg, var(--gold), #d4a03d)';
            }
        }

        // --- ABF Corpo ---
        const corpoKeys = CORPO_STEPS.map(s => s.checkKey);
        let corpoCompleted = 0;
        const corpoTotal = corpoKeys.length;

        corpoKeys.forEach(checkId => {
            const isComplete = sections[checkId] || false;
            const dotEl = document.querySelector(`.abf-node[data-check="${checkId}"]`);
            if (dotEl) {
                const wasDone = dotEl.classList.contains('done');
                if (isComplete) {
                    dotEl.classList.add('done');
                    if (!wasDone) {
                        dotEl.classList.add('just-completed');
                        setTimeout(() => dotEl.classList.remove('just-completed'), 500);
                    }
                    corpoCompleted++;
                } else {
                    dotEl.classList.remove('done');
                }
            } else if (isComplete) {
                corpoCompleted++;
            }
        });

        // Barre ABF Corpo
        const corpoBar = document.getElementById('corpoProgressBar');
        const corpoText = document.getElementById('corpoProgressText');

        if (corpoBar && corpoText) {
            const corpoPct = Math.round((corpoCompleted / corpoTotal) * 100);
            corpoBar.style.width = `${corpoPct}%`;
            corpoText.textContent = `${corpoPct}%`;

            if (corpoPct >= 100) {
                corpoBar.style.background = 'linear-gradient(90deg, #10b981, #059669)';
            } else if (corpoPct >= 50) {
                corpoBar.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
            } else {
                corpoBar.style.background = 'linear-gradient(90deg, var(--gold), #d4a03d)';
            }
        }

        // Vérifier si tout est complété (célébration)
        checkAllDoneCelebration(getActiveSteps(), 'abfStepper', '🎉 ABF 100% complété !');
    }

    // ==========================================
    // MISE À JOUR DES CHECKMARKS GESTION
    // ==========================================
    function updateGestionCheckmarks() {
        const client = FINOX.getClientData();
        if (!client) return;

        const abfData = client.abf_data || {};
        const sections = getCompletionMap(abfData);

        const gestKeys = GESTION_STEPS.map(s => s.checkKey);

        // Mettre à jour les nodes du stepper gestion
        gestKeys.forEach(checkId => {
            const isComplete = sections[checkId] || false;
            const dotEl = document.querySelector(`#gestionStepper .abf-node[data-check="${checkId}"]`);
            if (dotEl) {
                const wasCompleted = dotEl.classList.contains('completed');
                if (isComplete) {
                    dotEl.classList.add('completed');
                    if (!wasCompleted) {
                        dotEl.classList.add('just-completed');
                        setTimeout(() => dotEl.classList.remove('just-completed'), 500);
                    }
                } else {
                    dotEl.classList.remove('completed');
                }
            }
        });

        checkAllDoneCelebration(GESTION_STEPS, 'gestionStepper', '🎉 Affaires 100% complétées !');
    }

    // ==========================================
    // INITIALISATION COMPLÈTE
    // ==========================================
    async function initNavSystem() {
        if (navSystemInitialized) {
            log.warn('[Nav] Déjà initialisé, skip');
            return;
        }
        navSystemInitialized = true;

        if (!FINOX.CLIENT_ID) {
            log.warn('[Nav] Pas de CLIENT_ID');
        }

        initNavigation();
        initVolets();
        initHistoryHandler();
        initMobileSidebar();
        initBeforeUnload();

        // Charger les infos en parallèle (plus rapide)
        updateSidebarUserInfo();
        await Promise.all([
            updateSidebarClientInfo(),
            updateAffairesBadge(),
            updateAssurancesBadge(),
            updatePlacementsBadge(),
            updateDocumentsBadge(),
            updateOppBadge()
        ]);

        const initialModule = getInitialModule();
        loadModule(initialModule, false);

        log.debug('[Nav] Système initialisé');
    }

    // ==========================================
    // EXPORT GLOBAL
    // ==========================================
    window.FINOX_NAV = {
        loadModule,
        toggleVolet,
        toggleSidebar,
        updateSidebarClientInfo,
        updateSidebarUserInfo,
        updateABFCheckmarks,
        updateGestionCheckmarks,
        updateAffairesBadge,
        updateAssurancesBadge,
        updatePlacementsBadge,
        updateDocumentsBadge,
        updateOppBadge,
        toggleCorpoMode,
        getCurrentModule: () => currentModule,

        markAsUnsaved,
        markAsSaved,
        saveCurrentModule,
        manualSave,
        hasUnsavedChanges: () => hasUnsavedChanges,

        // Initialisation (appelé par app.html et abf.html)
        initNavSystem
    };

    // Exposer les fonctions globalement pour les appels depuis HTML
    window.loadModule = loadModule;
    window.initNavSystem = initNavSystem;

})();
