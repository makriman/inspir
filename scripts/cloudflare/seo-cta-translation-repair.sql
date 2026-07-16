UPDATE app_translations
SET
  payload = json_remove(
    payload,
    '$."site.ee30b035ee17c34450"',
    '$."site.5121f7306ecc75edb5"',
    '$."site.df499d7c6f44a88703"',
    '$."site.19abb1657a1d5e54c2"',
    '$."site.2ced57f125910a9e8a"',
    '$."site.649df08a448ee3fa90"',
    '$."site.2ac5cdad2988ba0c40"',
    '$."site.b78a38d18d6555118d"',
    '$."site.4b0412c73bb17a566f"',
    '$."site.97d1bd7fe820bd7b27"'
  ),
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE namespace = 'marketing-site'
  AND (
    json_type(payload, '$."site.ee30b035ee17c34450"') IS NOT NULL
    OR json_type(payload, '$."site.5121f7306ecc75edb5"') IS NOT NULL
    OR json_type(payload, '$."site.df499d7c6f44a88703"') IS NOT NULL
    OR json_type(payload, '$."site.19abb1657a1d5e54c2"') IS NOT NULL
    OR json_type(payload, '$."site.2ced57f125910a9e8a"') IS NOT NULL
    OR json_type(payload, '$."site.649df08a448ee3fa90"') IS NOT NULL
    OR json_type(payload, '$."site.2ac5cdad2988ba0c40"') IS NOT NULL
    OR json_type(payload, '$."site.b78a38d18d6555118d"') IS NOT NULL
    OR json_type(payload, '$."site.4b0412c73bb17a566f"') IS NOT NULL
    OR json_type(payload, '$."site.97d1bd7fe820bd7b27"') IS NOT NULL
  );
