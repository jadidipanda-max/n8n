# Collecte Google Maps (Apify) : chauffagistes et climatisation dans 30 villes, dans la limite du crédit restant.
import json, sys, time, requests
T = open('../.apify/token').read().strip()
S = requests.Session(); S.headers['Authorization'] = 'Bearer ' + T
ACT = 'compass~crawler-google-places'
PRIX = 0.005  # $ par fiche, constaté sur la collecte pest control (640 fiches = 3,20 $)
CITIES = ["Nice", "Nantes", "Montpellier", "Strasbourg", "Bordeaux", "Lille", "Rennes", "Reims", "Toulon", "Saint-Étienne", "Le Havre", "Grenoble", "Dijon", "Angers", "Nîmes",
          "Clermont-Ferrand", "Aix-en-Provence", "Le Mans", "Brest", "Tours", "Amiens", "Limoges", "Perpignan", "Metz", "Besançon", "Orléans", "Rouen", "Caen", "Nancy", "Avignon"]
TERMS = ["chauffagiste", "climatisation"]

lim = S.get('https://api.apify.com/v2/users/me/limits', timeout=30).json()['data']
reste = (lim['limits'].get('maxMonthlyUsageUsd') or 0) - (lim['current'].get('monthlyUsageUsd') or 0)
budget = min(float(sys.argv[1]) if len(sys.argv) > 1 else reste, reste) - 0.05
searches = [f"{t} {c}" for c in CITIES for t in TERMS]
per = int(budget / PRIX // len(searches))
print(f'crédit restant {reste:.2f} $ · budget {budget:.2f} $ · {len(searches)} recherches × {per} fiches', flush=True)
if per < 3: sys.exit('crédit insuffisant')
inp = {"language": "fr", "countryCode": "fr", "scrapePlaceDetailPage": False, "scrapeContacts": False, "maxReviews": 0, "maxImages": 0,
       "maxQuestions": 0, "includeWebResults": False, "scrapeDirectories": False, "scrapeTableReservationProvider": False, "scrapeOrderOnline": False,
       "scrapeReviewsPersonalData": False, "maximumLeadsEnrichmentRecords": 0, "skipClosedPlaces": True,
       "searchStringsArray": searches, "maxCrawledPlacesPerSearch": per}
r = S.post(f'https://api.apify.com/v2/acts/{ACT}/runs', params={'memory': 4096, 'maxTotalChargeUsd': round(budget, 2)}, json=inp, timeout=60)
r.raise_for_status(); d = r.json()['data']; rid, ds = d['id'], d['defaultDatasetId']
print('run lancé', flush=True)
while True:
    time.sleep(20)
    st = S.get(f'https://api.apify.com/v2/actor-runs/{rid}', timeout=30).json()['data']
    if st['status'] in ('SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'): break
items = S.get(f'https://api.apify.com/v2/datasets/{ds}/items', params={'clean': 'true', 'format': 'json'}, timeout=180).json()
json.dump(items, open('raw/maps.json', 'w'), ensure_ascii=False)
u = S.get('https://api.apify.com/v2/users/me/limits', timeout=30).json()['data']
print('fin', st['status'], len(items), 'fiches · dépense du mois', round(u['current'].get('monthlyUsageUsd') or 0, 2), '$ sur', u['limits'].get('maxMonthlyUsageUsd'), '$', flush=True)
