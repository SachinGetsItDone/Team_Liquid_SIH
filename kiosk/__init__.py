"""MediKiosk production kiosk application (frontend + API orchestration).

This package is the thin-kiosk runtime described in doc/19. It does not
re-implement clinical logic: it drives the real Module A capture contract,
the real Module B (`medib`) document pipeline, and the real Module C
(`medic`) summary generator, and serves the patient and physician surfaces.
"""
