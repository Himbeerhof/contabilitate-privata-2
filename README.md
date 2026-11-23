# Contabilitate privată

Versiunea nouă (separată) a aplicației pentru facturi, Lieferscheine, E-Rechnung, casă și contabilitate.
Aplicația folosită zilnic rămâne neschimbată la https://app.sidor-digital.de; aceasta are adresa și datele ei proprii.

Sursele din care se construiește stau separat; aici e doar aplicația publicată.

## Fișiere
- `index.html` – aplicația
- `cp-extra.js` – E-Rechnung primite, documente atașate, închiderea lunii, backup automat, DATEV, declarația TVA, somații, ZUGFeRD, § 24
- `cp-core.js` – sincronizarea și criptarea (construit din surse)
- `tests/` – teste automate (nu fac parte din aplicație)

## Teste
```bash
npm install
npm test            # teste în browser simulat
KOSIT=1 npm test    # + validatorul oficial XRechnung (KoSIT), necesită Java
```
Pe GitHub testele rulează automat la fiecare modificare (Actions → „Teste”).
