// Date de test: o firmă, un client și facturi tipice
const SETTINGS = { name: "Himbeerhof Test", owner: "Ion Test", street: "Hauptstr. 1", zip: "88099", city: "Neukirch", country: "Deutschland",
  phone: "+49 7528 1234", email: "hof@example.de", iban: "DE02120300000000202051", bic: "BYLADEM1001", holder: "Ion Test", bank: "Testbank",
  profiles: { de: { taxNo: "12/345/67890", vatId: "DE123456789", vatRates: "7; 19; 0", defaultVat: 7, prefix: "RE", reStart: 1 },
              at: { taxNo: "", vatId: "ATU12345678", vatRates: "10; 13; 20; 0", defaultVat: 10, prefix: "RE-AT", reStart: 1 } } };
const CUSTOMER = { id: "c1", name: "Obst Großhandel GmbH", address: "Marktplatz 5\n88212 Ravensburg", number: "K-1001", vatId: "DE987654321", email: "rechnung@obst.example", buyerRef: "04011000-12345-34", profileId: "de" };
const inv = (o = {}) => ({ id: "i" + Math.random().toString(36).slice(2), profileId: "de", number: "RE-2026-001", date: "2026-07-15", serviceDate: "", dueDate: "2026-07-29", paidDate: "",
  status: "open", lang: "de", kleinunternehmer: false, currency: "EUR", customerId: "c1",
  customer: { name: CUSTOMER.name, address: CUSTOMER.address, number: CUSTOMER.number, vatId: CUSTOMER.vatId, email: CUSTOMER.email, buyerRef: CUSTOMER.buyerRef },
  items: [{ date: "2026-07-10", desc: "Himbeeren", count: "40", per: "2,5", qty: "100", unit: "kg", price: "6,45", vat: "7", ls: "2026-12" },
          { date: "2026-07-12", desc: "Holzkisten", qty: "3", unit: "Stk.", price: "4,20", vat: "19" }],
  intro: "", notes: "", ...o });
// o factură UBL primită de la un furnizor (2 cote TVA)
const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</cbc:CustomizationID>
<cbc:ID>SW-4711</cbc:ID><cbc:IssueDate>2026-08-03</cbc:IssueDate><cbc:DueDate>2026-08-17</cbc:DueDate><cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
<cac:AccountingSupplierParty><cac:Party><cac:PostalAddress><cbc:StreetName>Werkstr. 2</cbc:StreetName><cbc:CityName>Ulm</cbc:CityName><cbc:PostalZone>89073</cbc:PostalZone><cac:Country><cbc:IdentificationCode>DE</cbc:IdentificationCode></cac:Country></cac:PostalAddress>
<cac:PartyTaxScheme><cbc:CompanyID>DE111222333</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme><cac:PartyLegalEntity><cbc:RegistrationName>Stadtwerke Test GmbH</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Himbeerhof Test</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>
<cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode><cac:PayeeFinancialAccount><cbc:ID>DE89370400440532013000</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">22.80</cbc:TaxAmount>
<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">100.00</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">19.00</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>
<cac:TaxSubtotal><cbc:TaxableAmount currencyID="EUR">54.29</cbc:TaxableAmount><cbc:TaxAmount currencyID="EUR">3.80</cbc:TaxAmount><cac:TaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>7</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="EUR">154.29</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount currencyID="EUR">154.29</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="EUR">177.09</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="EUR">177.09</cbc:PayableAmount></cac:LegalMonetaryTotal>
<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="KWH">400</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">100.00</cbc:LineExtensionAmount><cac:Item><cbc:Name>Strom August</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">0.25</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
<cac:InvoiceLine><cbc:ID>2</cbc:ID><cbc:InvoicedQuantity unitCode="MTQ">20</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="EUR">54.29</cbc:LineExtensionAmount><cac:Item><cbc:Name>Wasser</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>7</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="EUR">2.7145</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
</Invoice>`;
module.exports = { SETTINGS, CUSTOMER, inv, UBL };
