\set ON_ERROR_STOP 1
do $$ begin
  assert normalize_phone('+91 98200 11111') = '9820011111', '+91';
  assert normalize_phone('919820011111') = '9820011111', '91 no plus';
  assert normalize_phone('09820011111') = '9820011111', 'leading 0';
  assert normalize_phone('+91 (0) 98200 11111') = '9820011111', '+91 (0)';
  assert normalize_phone('+91-098200-11111') = '9820011111', '+91-0';
  assert normalize_phone('0091 98200 11111') = '9820011111', '0091';
  assert normalize_phone('00971 50 123 4567') = '+971501234567', '00 international';
  assert normalize_phone('+65 9123 4567') = '+6591234567', 'Singapore keeps code';
  assert normalize_phone('+1 (415) 555-0123') = '+14155550123', 'US';
  assert normalize_phone('022 2345 6789') = '2223456789', 'landline with STD code';
  assert normalize_phone('98200 111') is null, 'too short rejected';
  assert normalize_phone('') is null and normalize_phone(null) is null, 'empty';
end $$;
select 'PHONE TESTS PASSED' as result;
