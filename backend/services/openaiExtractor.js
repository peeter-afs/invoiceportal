const OpenAI = require('openai');

let client;
function getClient() {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    client = new OpenAI({ apiKey });
  }
  return client;
}

const EXTRACTION_PROMPT = `You are an invoice extraction system. Extract all data from this invoice text and return it as a JSON object.

Invoices may be in Estonian, Finnish, English, or other languages. Use these field mappings:

ESTONIAN → ENGLISH FIELD MAPPING:
  Müüja / Hankija → supplierName (seller/vendor)
  Arve nr / Arve number → invoiceNumber
  Kuupäev / Arve kuupäev → invoiceDate
  Makseviis / Makseaeg → paymentTerms (payment method/terms)
  Tähtaeg / Maksetähtaeg → dueDate (due date)
  Viivis %p. → penaltyRate (late penalty percentage)
  Viitenumber / Viitenr → referenceNumber (payment reference number)
  Tarnepäev / Lähetuskuupäev → deliveryDate
  Tarneviis → deliveryMethod
  Meie viide → buyerReference (our reference)
  Teie viide → sellerReference (your reference)
  Saatelehe nr → deliveryNoteNr (waybill/delivery note number)
  Tootekood / Kood → productCode
  Tootenimi / Nimetus / Kauba nimetus → description (product name)
  Hind km-ta / Ühiku hind → unitPrice (price without VAT)
  Tk / Kogus / Kgk → qty (quantity)
  Ühik → unit
  Kokku / Summa → net (line total)
  Kokku käibemaksuta / Summa km-ta → netTotal (total without VAT)
  Käibemaks / Km / KM → vatTotal (VAT amount)
  Kokku / Kokku tasuda / Arve summa → grossTotal (total to pay)
  Km % / Käibemaks % → vatRate
  Reg nr / Registrikood → supplierRegNumber (registration number)
  KMKR nr / Käibemaksukohustuslase nr → supplierVatNumber (VAT number)
  Pangakonto / Arveldusarve / IBAN → supplierBankAccount
  Tellimuse nr / Ostutellimus → purchaseOrderNr

FINNISH → ENGLISH FIELD MAPPING:
  Myyjä / Toimittaja → supplierName
  Laskun numero → invoiceNumber
  Laskun päivä → invoiceDate
  Eräpäivä → dueDate
  Viite / Viitenumero → referenceNumber
  Tuotekoodi → productCode
  Tuotenimi / Kuvaus → description
  Yksikköhinta → unitPrice
  Määrä → qty
  Yhteensä ilman ALV → netTotal
  ALV → vatTotal
  Yhteensä → grossTotal

Return ONLY valid JSON, no markdown, no explanation. Use this exact structure:
{
  "supplierName": "string or null",
  "supplierAddress": "string or null",
  "supplierRegNumber": "string or null",
  "supplierVatNumber": "string or null",
  "supplierBankAccount": "string or null",
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "dueDate": "YYYY-MM-DD or null",
  "currency": "ISO 4217 3-letter code e.g. EUR or null",
  "purchaseOrderNr": "string or null",
  "referenceNumber": "string or null",
  "penaltyRate": "string or null",
  "paymentTerms": "string or null",
  "deliveryDate": "YYYY-MM-DD or null",
  "deliveryMethod": "string or null",
  "deliveryNoteNr": "string or null",
  "buyerReference": "string or null",
  "sellerReference": "string or null",
  "lines": [
    {
      "rowNo": 1,
      "productCode": "string or null",
      "description": "string",
      "qty": number or null,
      "unit": "string or null",
      "unitPrice": number or null,
      "net": number or null,
      "vatRate": number or null,
      "vatAmount": number or null,
      "gross": number or null
    }
  ],
  "netTotal": number or null,
  "vatTotal": number or null,
  "grossTotal": number or null,
  "confidence": number between 0 and 1
}

Rules:
- confidence = 1.0 if all key fields found, lower if missing important fields
- Use numbers for amounts, not strings
- dates must be YYYY-MM-DD or null
- vatRate as percentage (e.g. 24 for 24%)
- If a field is not present in the invoice, use null
- "Arve tasumisel kasutage viitenumbrit" means "Use reference number when paying the invoice" — extract the reference number from nearby text
- Currency is almost always EUR for Estonian/Finnish invoices if not explicitly stated
- Estonian dates may be in DD.MM.YYYY format — convert to YYYY-MM-DD`;

async function extract(invoiceText, filename) {
  const openai = getClient();

  const model = process.env.OPENAI_MODEL || 'gpt-4o';

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      {
        role: 'user',
        content: `Invoice filename: ${filename}\n\n--- INVOICE TEXT ---\n${invoiceText}`,
      },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const rawJson = completion.choices[0].message.content;
  const parsed = JSON.parse(rawJson);

  return {
    ...parsed,
    extractedBy: 'openai',
    model,
    rawResponse: rawJson,
  };
}

module.exports = { extract };
