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
  source_hash = '8fba4fae8adf717ba9de242b46c5b0f1861b2414209355280f36e25ae6992166',
  model = 'codex-curated-free-static-no-games-v4',
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE namespace = 'marketing-site'
  AND source_hash IN (
    'ec84387ca93fbec6a68df90e756a5b64af6dc401b0fefbc4646866ee897b228b',
    '784fb3090db46f80d95db18611a9c8f6c784cccb397e2a0634e658734b6e5d39',
    'f14328ad17e645fbc8d904da8d2892fae56e9c7a41b54b8aa108c89eaf7611b0',
    '8fba4fae8adf717ba9de242b46c5b0f1861b2414209355280f36e25ae6992166'
  );

UPDATE app_translations
SET
  payload = json_remove(
    payload,
    '$."site.c737278d536db3a59e"',
    '$."site.19abb1657a1d5e54c2"',
    '$."site.2ced57f125910a9e8a"',
    '$."site.efd5b7d0291c46f8f7"',
    '$."site.649df08a448ee3fa90"',
    '$."site.2ac5cdad2988ba0c40"',
    '$."site.b78a38d18d6555118d"',
    '$."site.4b0412c73bb17a566f"',
    '$."site.0ceccded9174305dc1"'
  ),
  source_hash = 'f5ef074ab3712ef9b40cb5fcbc794e9b7d42efd2089fc22400aeb280abce8689',
  model = 'codex-curated-free-static-no-games-v4',
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE namespace = 'route:chat-public'
  AND source_hash IN (
    '86bf6df3dfce89c2fafc10af32f4300e6c485e93c5e1dbbf473fa792081bd317',
    'f5ef074ab3712ef9b40cb5fcbc794e9b7d42efd2089fc22400aeb280abce8689'
  );

UPDATE app_translations AS target
SET
  payload = json_set(
    target.payload,
    '$."site.02d279ce2f7b58c890"',
    (
      SELECT json_extract(source.payload, '$."site.02d279ce2f7b58c890"')
      FROM app_translations AS source
      WHERE source.namespace = 'route:home'
        AND source.language = target.language
        AND source.source_hash = 'fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce'
    )
  ),
  source_hash = '6aa44ee2349a660b840519a4fc03037976d4e26ee4ceb55d7d94e2959b211a99',
  model = 'codex-curated-free-static-no-games-v4',
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE target.namespace = 'route:about'
  AND EXISTS (
    SELECT 1
    FROM app_translations AS source
    WHERE source.namespace = 'route:home'
      AND source.language = target.language
      AND source.source_hash = 'fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce'
      AND json_type(source.payload, '$."site.02d279ce2f7b58c890"') = 'text'
      AND TRIM(json_extract(source.payload, '$."site.02d279ce2f7b58c890"')) <> ''
  );

UPDATE app_translations AS target
SET
  payload = json_set(
    target.payload,
    '$."site.02d279ce2f7b58c890"',
    (
      SELECT json_extract(source.payload, '$."site.02d279ce2f7b58c890"')
      FROM app_translations AS source
      WHERE source.namespace = 'route:home'
        AND source.language = target.language
        AND source.source_hash = 'fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce'
    )
  ),
  source_hash = '8f437d1337e18df480b2aef7ced339482fa4b1d53653e29fa7b06ae881a77982',
  model = 'codex-curated-free-static-no-games-v4',
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE target.namespace = 'route:media'
  AND EXISTS (
    SELECT 1
    FROM app_translations AS source
    WHERE source.namespace = 'route:home'
      AND source.language = target.language
      AND source.source_hash = 'fab351f36a82182656bcf48d9cce7ac2abb9f654a65e7e04a0efb7b50fbb86ce'
      AND json_type(source.payload, '$."site.02d279ce2f7b58c890"') = 'text'
      AND TRIM(json_extract(source.payload, '$."site.02d279ce2f7b58c890"')) <> ''
  );

WITH repair_values(language, value) AS (
  VALUES
    ('Afrikaans', 'Probeer die openbare modusse'),
    ('Albanian', 'Provoni modalitetet publike'),
    ('Amharic', 'ለሁሉም ክፍት የሆኑ ሁነታዎችን ይሞክሩ'),
    ('Arabic', 'جرّب الأوضاع العامة'),
    ('Armenian', 'Փորձեք հանրային ռեժիմները'),
    ('Assamese', 'ৰাজহুৱা মোডসমূহ ব্যৱহাৰ কৰি চাওক'),
    ('Azerbaijani', 'Hamı üçün açıq rejimləri sınayın'),
    ('Basque', 'Probatu modu publikoak'),
    ('Bengali', 'সর্বজনীন মোডগুলো ব্যবহার করে দেখুন'),
    ('Bosnian', 'Isprobajte javne načine rada'),
    ('Bulgarian', 'Изпробвайте публичните режими'),
    ('Catalan', 'Prova els modes públics'),
    ('Chinese', '试用公开模式'),
    ('Croatian', 'Isprobajte javne načine rada'),
    ('Czech', 'Vyzkoušejte veřejné režimy'),
    ('Danish', 'Prøv de læringsformer, der er åbne for alle'),
    ('Dutch', 'Probeer de openbare modi'),
    ('Estonian', 'Proovige avalikke režiime'),
    ('Filipino', 'Subukan ang mga mode na bukas sa lahat'),
    ('Finnish', 'Kokeile julkisia toimintatiloja'),
    ('French', 'Essayez les modes publics'),
    ('Galician', 'Proba os modos públicos'),
    ('Georgian', 'სცადეთ საჯარო რეჟიმები'),
    ('German', 'Öffentliche Modi ausprobieren'),
    ('Greek', 'Δοκιμάστε τους τρόπους μάθησης που είναι διαθέσιμοι σε όλους'),
    ('Gujarati', 'સાર્વજનિક મોડ્સ અજમાવી જુઓ'),
    ('Hausa', 'Gwada hanyoyin koyo da ke buɗe ga kowa'),
    ('Hebrew', 'נסו את המצבים הציבוריים'),
    ('Hindi', 'सार्वजनिक मोड आज़माएं'),
    ('Hungarian', 'Próbáld ki a nyilvános módokat'),
    ('Icelandic', 'Prófaðu opinbera hami'),
    ('Indonesian', 'Coba mode publik'),
    ('Irish', 'Bain triail as na modhanna poiblí'),
    ('Italian', 'Prova le modalità pubbliche'),
    ('Japanese', '公開モードを試す'),
    ('Kannada', 'ಸಾರ್ವಜನಿಕ ಮೋಡ್‌ಗಳನ್ನು ಪ್ರಯತ್ನಿಸಿ'),
    ('Korean', '공개 모드 사용해 보기'),
    ('Latvian', 'Izmēģiniet publiskos režīmus'),
    ('Lithuanian', 'Išbandykite viešuosius režimus'),
    ('Malay', 'Cuba mod awam'),
    ('Malayalam', 'പൊതു മോഡുകൾ പരീക്ഷിക്കുക'),
    ('Marathi', 'सार्वजनिक मोड वापरून पाहा'),
    ('Nepali', 'सार्वजनिक मोडहरू प्रयोग गरेर हेर्नुहोस्'),
    ('Norwegian', 'Prøv offentlige moduser'),
    ('Odia', 'ସାର୍ବଜନିକ ମୋଡ୍‌ଗୁଡ଼ିକୁ ଚେଷ୍ଟା କରନ୍ତୁ'),
    ('Persian', 'حالت‌های عمومی را امتحان کنید'),
    ('Polish', 'Wypróbuj tryby publiczne'),
    ('Portuguese', 'Experimente os modos públicos'),
    ('Punjabi', 'ਜਨਤਕ ਮੋਡ ਅਜ਼ਮਾ ਕੇ ਦੇਖੋ'),
    ('Romanian', 'Încearcă modurile publice'),
    ('Russian', 'Попробуйте общедоступные режимы'),
    ('Serbian', 'Испробајте јавне режиме'),
    ('Sinhala', 'පොදු ඉගෙනුම් ක්‍රම අත්හදා බලන්න'),
    ('Slovak', 'Vyskúšajte verejné režimy'),
    ('Slovenian', 'Preizkusite javne načine delovanja'),
    ('Somali', 'Tijaabi hababka u furan dadweynaha'),
    ('Spanish', 'Prueba los modos públicos'),
    ('Swahili', 'Jaribu njia za kujifunza zinazopatikana kwa wote'),
    ('Swedish', 'Prova publika lägen'),
    ('Tamil', 'பொது பயன்முறைகளை முயன்று பாருங்கள்'),
    ('Telugu', 'పబ్లిక్ మోడ్‌లను ప్రయత్నించండి'),
    ('Thai', 'ลองใช้โหมดสาธารณะ'),
    ('Turkish', 'Herkese açık modları deneyin'),
    ('Ukrainian', 'Спробуйте загальнодоступні режими'),
    ('Urdu', 'عوامی موڈز آزمائیں'),
    ('Vietnamese', 'Thử các chế độ công khai'),
    ('Welsh', 'Rhowch gynnig ar y moddau cyhoeddus'),
    ('Yoruba', 'Gbìyànjú àwọn ipò tó ṣí sí gbogbo ènìyàn'),
    ('Zulu', 'Zama izimodi ezivulekele wonke umuntu')
)
UPDATE app_translations AS target
SET
  payload = json_set(
    target.payload,
    '$."site.fc4ad9c971ade5617d"',
    (
      SELECT repair_values.value
      FROM repair_values
      WHERE repair_values.language = target.language
    )
  ),
  source_hash = '2c3294f27d9887dd9fbb10d0ad2147c31960a75ace708d1b3fc750416e6adabe',
  model = 'codex-curated-free-static-no-games-v4',
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE target.namespace = 'route:schools'
  AND EXISTS (
    SELECT 1
    FROM repair_values
    WHERE repair_values.language = target.language
  );
