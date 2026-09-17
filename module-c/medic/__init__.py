"""MediKiosk Module C - Structured History Summary Generator.

Implements the Module C contract from doc/15 section 1:
merge Module A's HistoryBundle + Module B's DocumentBundle into ONE canonical
case summary (store-once), render MANY views from it (SOAP, OLD CARTS,
bilingual patient read-back - doc/04 "store once, render many"), and emit the
physician-facing NRCeS OPConsultRecord document bundle. Never diagnoses:
Assessment and Plan stay physician-only.
"""
