Overdrachtsdocument: Gedetailleerde Analyse van Backend API v3.0
Datum: 26 mei 2024
Project: MijnLVS Backend API
Doel: Gedetailleerde technische overdracht van de gerefactorde backend-architectuur.
1. Overkoepelende Visie van de Refactoring
De backend is getransformeerd van een monolithische server.js naar een modulaire, "feature-based" architectuur. De kernprincipes waren Single Responsibility Principle (elk bestand heeft één taak) en Separation of Concerns (scheiding van database-logica, routing, bedrijfsregels en web-server-configuratie). Dit resulteert in een significant verbeterde onderhoudbaarheid, testbaarheid en schaalbaarheid.
2. Gedetailleerde Beschrijving per Bestand
Hieronder volgt een analyse van de rol van elk bestand in de nieuwe structuur.
server.js
Rol: De orchestrator en het startpunt van de applicatie.
Verantwoordelijkheden:
Initialiseert de Express-app.
Stelt essentiële middleware in, zoals cors en express.json.
Definieert een specifieke, "raw" body parser voor de Stripe webhook-route, wat cruciaal is voor de signatuurverificatie.
Importeert en koppelt alle routers uit de /routes map aan hun respectievelijke basispaden (bv. app.use('/api/users', userRoutes)).
Past de authenticatie- en abonnementsmiddleware toe op alle beveiligde routes.
Koppelt de centrale error-handling middleware.
Start de server en luistert op de geconfigureerde poort.
Belangrijkste wijziging: Deze file bevat geen concrete API-logica meer, maar delegeert dit volledig naar de geïmporteerde modules.
package.json
Rol: Definieert projectmetadata en afhankelijkheden.
Belangrijkste wijziging: De bcrypt dependency is verwijderd, omdat de applicatie nu volledig vertrouwt op Supabase Auth voor wachtwoordbeheer. Een devDependencies sectie met nodemon is toegevoegd voor een betere ontwikkelervaring.
database.js
Rol: Centrale initialisatie en export van de Supabase client.
Verantwoordelijkheden:
Leest de SUPABASE_URL en SUPABASE_SERVICE_KEY uit de environment variabelen.
Voert kritieke startup-checks uit om te valideren dat de variabelen correct zijn ingesteld en dat het een service_role key is.
Maakt één enkele, herbruikbare supabase client instantie aan met de juiste configuratie voor server-side gebruik (bv. persistSession: false).
Exporteert deze instantie zodat de rest van de applicatie (routes, services) hiermee kan communiceren zonder deze opnieuw te hoeven initialiseren.
Voert een testquery uit bij het starten om de databaseconnectiviteit te verifiëren.
stripe.js
Rol: Centrale initialisatie en export van de Stripe client.
Verantwoordelijkheden:
Leest de STRIPE_SECRET_KEY.
Maakt een enkele, herbruikbare stripe client instantie aan.
Exporteert deze instantie voor gebruik in paymentRoutes.js en stripeService.js.
authMiddleware.js
Rol: Verifieert de JWT van een inkomend verzoek en koppelt de gebruiker aan het req object.
Werking:
Leest de Authorization: Bearer <token> header.
Gebruikt supabase.auth.getUser(token) om de token te valideren bij Supabase.
Indien succesvol, haalt het de volledige gebruikersprofiel op uit onze eigen users tabel.
Koppelt dit profiel aan req.user, waardoor alle volgende routes en middleware toegang hebben tot de ingelogde gebruiker.
subscription.js
Rol: Handhaaft de business rules met betrekking tot abonnementen en limieten.
Werking:
Wordt na authMiddleware uitgevoerd.
Controleert of de gebruiker (req.user) een actieve proefperiode of abonnement heeft.
Blokkeert API-calls als een proefperiode is verlopen (403 TRIAL_EXPIRED).
Controleert limieten (bv. maximaal 10 leerlingen) voor gratis/proef-accounts en blokkeert acties die deze limiet overschrijden (403 LIMIT_REACHED).
errorMiddleware.js
Rol: Centrale afhandeling van alle errors en 404-responses.
Verantwoordelijkheden:
routeNotFoundHandler: Een "catch-all" middleware die wordt aangeroepen als geen enkele andere route matcht, en een 404-fout terugstuurt.
globalErrorHandler: De laatste middleware in de chain. Vangt alle errors op die in de routes worden gegooid (via next(error) of onverwachte fouten). Zorgt voor een consistente JSON-foutmelding naar de client en verbergt gevoelige stack traces in productie.
emailService.js
Rol: Bevat de complexe, herbruikbare logica voor het versturen van e-mails via de Microsoft Graph API.
Werking: De sendM365EmailInternal functie haalt per moskee de unieke M365-credentials uit de database, vraagt een OAuth2-token aan bij Microsoft, en verstuurt vervolgens de e-mail. Het logt ook elke poging (succes of falen) naar de email_logs tabel. Dit isoleert de complexe externe API-interactie van de route-handlers.
stripeService.js
Rol: Bevat de logica voor het verwerken van inkomende webhooks van Stripe.
Werking: De handleStripeWebhook functie verifieert de authenticiteit van het verzoek, parseert de event.type (bv. invoice.payment_succeeded), en voert de bijbehorende actie uit, zoals het updaten van de subscription_status in de mosques tabel.
calculationService.js
Rol: Isoleert pure, herbruikbare berekeningen.
Werking: De calculateAmountDueFromStaffel functie bevat de logica om op basis van het aantal kinderen en de instellingen van een moskee de juiste contributie te berekenen. Dit voorkomt dat deze logica in meerdere routes gedupliceerd wordt.
De routes map is het hart van de API. Elk bestand definieert een express.Router() voor een specifieke resource (gebruikers, klassen, etc.) en is verantwoordelijk voor:
Het definiëren van de specifieke URL-paden (bv. /:id of /:id/deactivate).
Het valideren van input.
Het uitvoeren van de autorisatiechecks (bv. if (req.user.role !== 'admin')).
Het aanroepen van de supabase client voor database-interacties.
Het aanroepen van services (bv. emailService) voor complexere taken.
Het terugsturen van een correcte JSON-respons of het doorgeven van een fout aan de errorMiddleware.
authRoutes.js: POST /login, POST /register. Publieke routes voor authenticatie.
userRoutes.js: CRUD voor gebruikers, inclusief wachtwoord-reset.
mosqueRoutes.js: CRUD voor moskee-instellingen (algemeen, M365, contributie).
classRoutes.js: CRUD voor klassen, inclusief "soft-delete" logica.
studentRoutes.js: CRUD voor studenten, inclusief geconsolideerde creatie-logica en absentiehistorie.
lessonRoutes.js: CRUD voor lessen en het opslaan van absenties per les.
paymentRoutes.js: Handmatige betalingsregistratie en het aanmaken van Stripe Checkout-sessies.
reportRoutes.js: Ophalen en opslaan van studentenrapporten.
quranRoutes.js: Beheer van Qor'aan-voortgang en statistieken.
emailRoutes.js: Endpoints voor het versturen van ad-hoc e-mails (bv. leraar naar klas).
errorHelper.js
Rol: Biedt een gestandaardiseerde, herbruikbare functie voor het versturen van foutmeldingen.
Werking: De sendError functie zorgt ervoor dat alle foutmeldingen die naar de client worden gestuurd dezelfde JSON-structuur hebben en dat de fout gelogd wordt in de console op de server.
5. Conclusie van de Overdracht
Deze refactoring transformeert de backend van een enkel script naar een robuust, professioneel en onderhoudbaar systeem. De heldere scheiding van verantwoordelijkheden maakt het voor elke ontwikkelaar eenvoudiger om snel de juiste code te vinden, aanpassingen te doen en nieuwe features te bouwen zonder de stabiliteit van de bestaande applicatie in gevaar te brengen.
De technische verbeteringen op het gebied van veiligheid, prestaties en logica zorgen voor een solide fundament voor de toekomst van MijnLVS.
Ik ben er klaar voor. Deel gerust de frontend-code wanneer je zover bent.