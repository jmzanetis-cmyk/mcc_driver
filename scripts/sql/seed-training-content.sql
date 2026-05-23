-- ============================================================
-- MCC Training — Seed lesson content
-- 6 modules × 4-6 lessons each × 3-5 questions each
-- Run AFTER create-driver-training.sql
-- ============================================================

-- ─── Helper: clear existing lesson/question content ──────────────────────────
DELETE FROM training_questions;
DELETE FROM training_lessons;

-- ─── MODULE 1: Platform Basics (slug = 'platform-basics') ────────────────────
DO $$
DECLARE
  mod_id UUID;
  l1 UUID; l2 UUID; l3 UUID; l4 UUID; l5 UUID;
BEGIN
  SELECT id INTO mod_id FROM training_modules WHERE slug = 'platform-basics';

  -- Lesson 1: How the Platform Works
  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'platform-how-it-works', 'How the Platform Works', 'text', 1,
    '[
      {"type":"text","body":"MCC (My Car Concierge) connects members who need vehicle-related concierge services with professional drivers like you. Unlike standard rideshare, MCC focuses on high-quality, white-glove service."},
      {"type":"step","number":1,"body":"A member submits a service request through the MCC app — this could be a passenger ride, a vehicle shuttle, or a full concierge job."},
      {"type":"step","number":2,"body":"The MCC dispatch system evaluates available drivers based on proximity, tier certification, and rating, then broadcasts the offer to the best-matched driver first."},
      {"type":"step","number":3,"body":"You receive a ride offer on your driver app with a 30-second response window. Accept or decline — your acceptance rate affects future offer priority."},
      {"type":"step","number":4,"body":"Complete the job, submit your post-ride report, and earnings are credited to your MCC wallet within 24 hours."},
      {"type":"tip","body":"Keep your app open and location enabled during your online hours. Dispatch routes offers to drivers who are actively tracking."},
      {"type":"important","body":"MCC is a platform for professional drivers only. Members expect punctuality, discretion, and a high standard of conduct at all times."}
    ]'::jsonb
  ) RETURNING id INTO l1;

  -- Lesson 2: Your Driver Tiers
  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'platform-driver-tiers', 'Driver Tiers & Certifications', 'text', 2,
    '[
      {"type":"text","body":"MCC uses a tiered system to match job complexity with driver qualification. Completing training modules unlocks higher-tier jobs with better pay."},
      {"type":"text","body":"Tier 0 — Entry level. Rideshare and delivery jobs. No certifications required. Flat per-mile rate applies."},
      {"type":"text","body":"Tier 1 — Passenger Rides. Direct passenger transport in a member''s or your own vehicle. Requires Passenger Rides certification."},
      {"type":"text","body":"Tier 2 — Solo Vehicle Shuttle. You drive the member''s personal vehicle without a passenger. Requires Solo Vehicle Shuttle certification."},
      {"type":"text","body":"Tier 3 — Tandem Jobs. Two-driver jobs involving vehicle relocation. Requires both Solo Vehicle Shuttle AND Tandem & Concierge certifications."},
      {"type":"text","body":"Tier 4 — Full Concierge. Complex multi-step jobs. Requires Tandem & Concierge certification. Highest pay tier."},
      {"type":"tip","body":"Complete Platform Basics first, then tackle Passenger Rides — it unlocks the most common job type on the platform."},
      {"type":"warning","body":"Accepting a job above your certification tier is not possible — the dispatch system enforces this automatically."}
    ]'::jsonb
  ) RETURNING id INTO l2;

  -- Lesson 3: Going Online and Managing Availability
  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'platform-availability', 'Going Online & Managing Availability', 'text', 3,
    '[
      {"type":"text","body":"Your availability is controlled by the Online/Offline toggle on your home screen. You only receive ride offers while Online."},
      {"type":"step","number":1,"body":"Tap the Online toggle on your home screen. The app will verify your location is enabled and documents are valid before switching you online."},
      {"type":"step","number":2,"body":"While online, keep the app in the foreground or ensure background location is enabled so dispatch can accurately calculate your distance to pickup points."},
      {"type":"step","number":3,"body":"When you need a break, tap the toggle to go Offline. Active rides must be completed first — you cannot go offline mid-trip."},
      {"type":"important","body":"If your license, insurance, or vehicle registration is expired, you will be blocked from going online until the document is updated in the Documents section."},
      {"type":"tip","body":"Schedule your online hours in advance using the Schedule screen. Scheduled shifts can qualify for guaranteed-minimum promotions."},
      {"type":"scenario","title":"Scenario: Your phone battery is at 5%","body":"Going offline immediately protects you from receiving an offer you can''t complete. Always carry a car charger — running out of battery mid-job is treated as an incomplete trip."}
    ]'::jsonb
  ) RETURNING id INTO l3;

  -- Lesson 4: Earnings, Ratings, and Your Acceptance Rate
  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'platform-earnings-ratings', 'Earnings, Ratings & Acceptance Rate', 'text', 4,
    '[
      {"type":"text","body":"Your earnings, acceptance rate, and average rating are the three metrics that determine your standing on the platform and your access to premium jobs."},
      {"type":"text","body":"Earnings: You receive 85% of the member-facing fare. Tips are 100% yours. Instant payout is available for a 1.5% fee; standard payout clears in 1-2 business days."},
      {"type":"text","body":"Ratings: Members rate you 1–5 stars after each completed job. Your rolling 30-day average must stay above 4.3 to remain in good standing. Disputes can be submitted via the Help screen."},
      {"type":"text","body":"Acceptance Rate: The percentage of offers you accept vs. decline. Drivers below 70% are deprioritized by dispatch. Letting an offer expire counts as a decline."},
      {"type":"warning","body":"Three consecutive declines in a single session may temporarily suppress offers for up to 15 minutes. Declines are normal — just don''t stack them without going offline."},
      {"type":"tip","body":"Your Performance screen shows acceptance rate, completion rate, and on-time rate trends. Review it weekly to catch dips before they affect your standing."}
    ]'::jsonb
  ) RETURNING id INTO l4;

  -- Lesson 5: The Driver App — Key Screens
  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'platform-app-overview', 'The Driver App — Key Screens', 'text', 5,
    '[
      {"type":"text","body":"The MCC Driver app is designed around a single home screen hub. Here''s a quick tour of the key areas you''ll use every day."},
      {"type":"step","number":1,"body":"Home Screen: Online toggle, live map, today''s earnings summary, and quick-action cards for Earnings, Training, and Settings."},
      {"type":"step","number":2,"body":"Navigate Screen: Active ride GPS, turn-by-turn directions, passenger status, and the SOS button. Use this for every active job."},
      {"type":"step","number":3,"body":"Earnings Screen: Full earnings history, payout requests, and weekly/monthly breakdowns."},
      {"type":"step","number":4,"body":"Settings Screen: Driver Tools (profile, safety, documents, performance, promotions, schedule, help) and app preferences."},
      {"type":"step","number":5,"body":"Notifications: System alerts, job updates, and certification announcements. Review these regularly — time-sensitive offers may appear here."},
      {"type":"tip","body":"The AI Support chat (robot icon on home) can answer most questions about earnings, vehicles, and platform policies instantly."}
    ]'::jsonb
  ) RETURNING id INTO l5;

  -- Questions for Lesson 1
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l1, 'What triggers the dispatch system to send you a ride offer?', 'multiple_choice',
   '{"a":"You manually request jobs from the dispatch queue","b":"A member submits a service request and the system matches you based on proximity, tier, and rating","c":"You call dispatch directly to accept jobs","d":"The system sends offers only to drivers who have been active for 2+ hours"}'::jsonb,
   'b', 'Dispatch is fully automated. When a member requests service, the system finds the best-matched available driver and sends an offer.', 1),
  (gen_random_uuid(), l1, 'How long do you have to respond to a ride offer?', 'multiple_choice',
   '{"a":"60 seconds","b":"2 minutes","c":"30 seconds","d":"15 seconds"}'::jsonb,
   'c', 'The response window is 30 seconds. Letting it expire counts as a decline and affects your acceptance rate.', 2),
  (gen_random_uuid(), l1, 'Earnings are credited to your MCC wallet within 24 hours of job completion.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'true', 'Standard earnings credit within 24 hours. Instant payout is available for a 1.5% fee if you need funds sooner.', 3);

  -- Questions for Lesson 2
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l2, 'Which certification is required to accept Tier 2 Solo Vehicle Shuttle jobs?', 'multiple_choice',
   '{"a":"Platform Basics","b":"Passenger Rides","c":"Solo Vehicle Shuttle","d":"Tandem & Concierge"}'::jsonb,
   'c', 'Tier 2 requires the Solo Vehicle Shuttle certification. This ensures drivers understand protocols for operating a member''s personal vehicle without a passenger present.', 1),
  (gen_random_uuid(), l2, 'A Tier 3 tandem job requires which two certifications?', 'multiple_choice',
   '{"a":"Platform Basics and Passenger Rides","b":"Solo Vehicle Shuttle and Tandem & Concierge","c":"Passenger Rides and Solo Vehicle Shuttle","d":"Any two certifications"}'::jsonb,
   'b', 'Tier 3 and Tier 4 jobs require both Solo Vehicle Shuttle AND Tandem & Concierge certifications, reflecting the complexity of multi-driver coordination.', 2),
  (gen_random_uuid(), l2, 'Can you accept a job above your current certification tier if the member specifically requests you?', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'The dispatch system enforces tier requirements automatically. No workaround exists — you must earn the certification to access higher-tier jobs.', 3),
  (gen_random_uuid(), l2, 'Which tier offers the highest pay rate?', 'multiple_choice',
   '{"a":"Tier 0","b":"Tier 1","c":"Tier 2","d":"Tier 4"}'::jsonb,
   'd', 'Tier 4 Full Concierge jobs offer the highest per-mile rate and typically involve complex, multi-step service that requires the most experience.', 4);

  -- Questions for Lesson 3
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l3, 'What happens if your driver''s license is expired when you try to go online?', 'multiple_choice',
   '{"a":"You are warned but can still go online","b":"You are blocked from going online until the document is updated","c":"Dispatch is notified automatically","d":"You receive a 24-hour grace period"}'::jsonb,
   'b', 'Expired documents (license, insurance, registration) block you from going online. Update your documents in the Documents section to restore access.', 1),
  (gen_random_uuid(), l3, 'You can go offline in the middle of an active trip if you need a break.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Active rides must be completed before you can go offline. Abandoning a trip mid-route is treated as an incomplete and affects your completion rate.', 2),
  (gen_random_uuid(), l3, 'What is the benefit of scheduling your online hours in advance?', 'multiple_choice',
   '{"a":"You receive bonus offers during scheduled hours","b":"Scheduled shifts can qualify for guaranteed-minimum promotions","c":"Your acceptance rate is paused during scheduled hours","d":"Background location is not required during scheduled hours"}'::jsonb,
   'b', 'Scheduled shifts may qualify you for guaranteed-minimum promotions during high-demand periods. Check the Schedule and Promotions screens for active offers.', 3);

  -- Questions for Lesson 4
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l4, 'What percentage of the member fare do you receive as a driver?', 'multiple_choice',
   '{"a":"70%","b":"80%","c":"85%","d":"90%"}'::jsonb,
   'c', 'Drivers receive 85% of the member-facing fare. Tips are always 100% yours with no platform deduction.', 1),
  (gen_random_uuid(), l4, 'What is the minimum 30-day average rating required to remain in good standing?', 'multiple_choice',
   '{"a":"4.0","b":"4.3","c":"4.5","d":"4.7"}'::jsonb,
   'b', 'A 4.3 rolling 30-day average is the good-standing threshold. Falling below triggers a warning. Consistent ratings below 4.0 may result in account review.', 2),
  (gen_random_uuid(), l4, 'Letting a ride offer expire has the same effect on your acceptance rate as actively declining it.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'true', 'An expired offer counts as a decline. If you need a break, go offline before offers arrive rather than letting them expire.', 3),
  (gen_random_uuid(), l4, 'What is the fee for using Instant Payout?', 'multiple_choice',
   '{"a":"0% — it''s free","b":"1%","c":"1.5%","d":"2.5%"}'::jsonb,
   'c', 'Instant Payout incurs a 1.5% processing fee. Standard payout (1-2 business days) is free.', 4);

  -- Questions for Lesson 5
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l5, 'Which screen provides GPS navigation and the SOS button during an active job?', 'multiple_choice',
   '{"a":"Home Screen","b":"Navigate Screen","c":"Settings Screen","d":"Notifications Screen"}'::jsonb,
   'b', 'The Navigate Screen is your active-ride command center. It shows turn-by-turn directions, passenger status, and the emergency SOS button.', 1),
  (gen_random_uuid(), l5, 'Where do you find the Performance screen?', 'multiple_choice',
   '{"a":"Home → Earnings","b":"Settings → Driver Tools","c":"Home → Notifications","d":"Navigate → Post-ride"}'::jsonb,
   'b', 'Driver Tools in Settings houses Profile, Safety, Documents, Performance, Promotions, Schedule, and Help.', 2),
  (gen_random_uuid(), l5, 'The AI Support chat can answer most platform questions without needing to contact human support.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'true', 'The AI Support chat (robot icon on the home screen) handles most questions about earnings, vehicles, and platform policies instantly. Use it for fast answers.', 3);

END $$;


-- ─── MODULE 2: Passenger Rides (slug = 'passenger-rides') ────────────────────
DO $$
DECLARE
  mod_id UUID;
  l1 UUID; l2 UUID; l3 UUID; l4 UUID;
BEGIN
  SELECT id INTO mod_id FROM training_modules WHERE slug = 'passenger-rides';

  -- Lesson 1: Passenger Pickup Protocol
  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'passenger-pickup', 'Passenger Pickup Protocol', 'text', 1,
    '[
      {"type":"text","body":"A flawless pickup sets the tone for the entire ride. MCC members expect a professional, stress-free experience from the moment you arrive."},
      {"type":"step","number":1,"body":"Arrive at the pickup address 2-3 minutes early. Park legally — never block driveways, fire hydrants, or crosswalks, even briefly."},
      {"type":"step","number":2,"body":"Send the arrival notification in your app when you''ve stopped. This notifies the member and starts the wait timer (5-minute grace period before fees apply)."},
      {"type":"step","number":3,"body":"Exit the vehicle and open the rear passenger door if the member is approaching with bags. For airport pickups, assist with luggage."},
      {"type":"step","number":4,"body":"Confirm the member''s name and destination: ''Hi, I''m [your name] with MCC. Heading to [destination]?'' Never state the destination first — this is a safety verification step."},
      {"type":"tip","body":"Keep your vehicle interior at a comfortable temperature before the member boards. A cold or overly hot car is a common low-rating trigger."},
      {"type":"warning","body":"Do not share your personal phone number, social media, or home address with members. All communication should stay within the MCC platform."}
    ]'::jsonb
  ) RETURNING id INTO l1;

  -- Lesson 2: In-Ride Standards
  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'passenger-in-ride', 'In-Ride Standards & Professionalism', 'text', 2,
    '[
      {"type":"text","body":"The in-ride experience is where your rating is made or lost. MCC members are accustomed to high standards — match and exceed them."},
      {"type":"text","body":"Conversation: Follow the member''s lead. Some want to chat; others want quiet. If they''re on a call or working, give them space. Never initiate personal topics or ask about their occupation or income."},
      {"type":"text","body":"Music and noise: Keep music off or at a low, neutral volume unless the member asks for it. Your personal playlist stays off."},
      {"type":"text","body":"Route: Follow the in-app navigation unless the member requests a specific route. If you deviate, explain briefly: ''There''s a lane closure ahead — taking [street] to avoid it.''"},
      {"type":"important","body":"Food and drink: Do not eat during a passenger ride. Bottled water in the cup holder for the member is a simple 5-star touch."},
      {"type":"tip","body":"Keep your vehicle scent-neutral. Avoid air fresheners with strong perfume. Some members have sensitivities. Clean and odor-free is always safe."},
      {"type":"scenario","title":"Scenario: Member asks you to make an unscheduled stop","body":"For brief, reasonable requests (pharmacy, ATM), comply courteously and tap ''Add Stop'' in the app so the mileage is tracked. For lengthy or unsafe detour requests, politely decline and note you''re on a timed schedule."}
    ]'::jsonb
  ) RETURNING id INTO l2;

  -- Lesson 3: Drop-Off and Completion
  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'passenger-dropoff', 'Drop-Off and Trip Completion', 'text', 3,
    '[
      {"type":"text","body":"A professional drop-off completes the experience and is your last chance to earn a 5-star rating."},
      {"type":"step","number":1,"body":"Give the member 30–60 seconds of advance notice: ''We''re about 2 minutes out.'' This lets them gather bags and wrap up calls."},
      {"type":"step","number":2,"body":"Choose the safest legal drop-off point. For hotels and office buildings, use the designated drop zone, not the main entrance driveway if it''s blocked."},
      {"type":"step","number":3,"body":"If the member has bags, exit and assist. Do not speed off before confirming they''re clear of the vehicle."},
      {"type":"step","number":4,"body":"In the app, tap ''Complete Ride'' only after the member has exited and you''ve confirmed the destination. The system automatically calculates the final fare."},
      {"type":"step","number":5,"body":"Perform a 10-second cabin check after each ride: phone, sunglasses, keys, bags. Submit a lost item report immediately if you find anything."},
      {"type":"tip","body":"A brief ''Thank you, have a great [morning/evening]'' as the member exits leaves a positive final impression. Keep it genuine, not scripted."}
    ]'::jsonb
  ) RETURNING id INTO l3;

  -- Lesson 4: Difficult Situations
  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'passenger-difficult', 'Handling Difficult Situations', 'text', 4,
    '[
      {"type":"text","body":"Even with excellent service, challenging situations arise. Knowing how to respond professionally protects you, the member, and your rating."},
      {"type":"text","body":"Intoxicated member: If a member appears severely impaired and becomes disruptive, you have the right to end the ride safely. Pull into a well-lit public area, calmly state you need to end the trip, and report via the Safety screen."},
      {"type":"text","body":"Member no-show: After the 5-minute free wait, a no-show fee begins accruing. If the member hasn''t contacted you by 10 minutes, you may mark the trip as a no-show in the app and it counts as completed."},
      {"type":"text","body":"Route disputes: If a member insists on a route you believe is unsafe or illegal, politely decline that specific instruction. You are responsible for the vehicle and your safety license."},
      {"type":"important","body":"Any situation involving a physical threat, harassment, or illegal activity requires immediate use of the SOS button. Your safety is the top priority."},
      {"type":"scenario","title":"Scenario: Member rates you 1 star with no explanation","body":"One outlier rating does not tank your average. If you believe a rating is retaliatory or inaccurate, submit a dispute via Help within 48 hours with the trip ID. MCC reviews all disputes within 3 business days."},
      {"type":"tip","body":"Keep a brief mental log of anything unusual during a ride. Specific details help if you need to file a report or dispute later."}
    ]'::jsonb
  ) RETURNING id INTO l4;

  -- Questions for Lesson 1
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l1, 'When confirming a passenger, what is the correct procedure?', 'multiple_choice',
   '{"a":"Say the destination first: ''I''m taking you to X?''","b":"Ask the member''s name and confirm the destination without stating it first","c":"Show your driver profile in the app for the member to verify","d":"Ask for the member''s booking confirmation number"}'::jsonb,
   'b', 'Always ask for the member''s name first, then confirm destination. Stating the destination first is a safety risk — it could allow the wrong person to board by simply agreeing.', 1),
  (gen_random_uuid(), l1, 'How long is the free wait period before a wait-time fee begins?', 'multiple_choice',
   '{"a":"2 minutes","b":"3 minutes","c":"5 minutes","d":"10 minutes"}'::jsonb,
   'c', 'Members receive a 5-minute grace period after you mark arrival. Wait-time fees begin accruing after that and are automatically added to the fare.', 2),
  (gen_random_uuid(), l1, 'You should share your personal phone number with regular members so they can book you directly.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'All communication and bookings must go through the MCC platform. Sharing personal contact details violates platform policy and may result in account suspension.', 3);

  -- Questions for Lesson 2
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l2, 'A member gets into your car and immediately takes a work call. What should you do?', 'multiple_choice',
   '{"a":"Introduce yourself and ask if they have any preferences","b":"Give them space, keep music off, and drive quietly","c":"Turn on music to fill the silence","d":"Ask if they need you to pull over so they can finish the call"}'::jsonb,
   'b', 'When a member is on a call, they''ve signaled they want to be left alone. Give them space, silence, and a smooth ride.', 1),
  (gen_random_uuid(), l2, 'A member requests a detour that adds 20 minutes to a time-sensitive job. You should:', 'multiple_choice',
   '{"a":"Always comply — the member''s preference takes priority","b":"Comply and say nothing","c":"Politely decline and note you''re on a timed schedule, or add the stop in-app if brief","d":"End the trip and report the request as inappropriate"}'::jsonb,
   'c', 'Brief reasonable stops can be accommodated in-app. Lengthy detours on time-sensitive jobs should be politely declined with a brief explanation.', 2),
  (gen_random_uuid(), l2, 'Strong air fresheners in your vehicle are generally appreciated by members.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Many members have fragrance sensitivities. A clean, scent-neutral vehicle is always the safest choice and a consistent 5-star baseline.', 3),
  (gen_random_uuid(), l2, 'What is a simple, low-cost way to improve your passenger rating?', 'multiple_choice',
   '{"a":"Play popular music during every ride","b":"Provide a complimentary bottled water in the cup holder","c":"Ask about the member''s day at the start of every trip","d":"Offer to carry all bags regardless of size"}'::jsonb,
   'b', 'A simple bottled water for the member is a well-known 5-star touch. It''s inexpensive, requires no interaction, and is consistently appreciated.', 4);

  -- Questions for Lesson 3
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l3, 'When should you tap "Complete Ride" in the app?', 'multiple_choice',
   '{"a":"As you approach the destination","b":"After the member has fully exited the vehicle and confirmed the destination","c":"When the member opens the door","d":"When you pull up to the drop-off address"}'::jsonb,
   'b', 'Complete the ride only after the member has exited. The system calculates the final fare at this point. Completing early can create fare disputes.', 1),
  (gen_random_uuid(), l3, 'What is the purpose of the 10-second cabin check after each ride?', 'multiple_choice',
   '{"a":"To verify the member''s rating","b":"To check your fuel level","c":"To find and report any items left behind by the member","d":"To confirm the trip distance in the app"}'::jsonb,
   'c', 'A quick cabin check catches left-behind items (phones, keys, glasses) immediately. Prompt lost item reports protect both you and the member.', 2),
  (gen_random_uuid(), l3, 'You do not need to assist members with luggage — that is optional and at your discretion.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'For airport pickups and any ride where a member has visible bags, assisting with luggage is part of the MCC service standard and expected conduct.', 3);

  -- Questions for Lesson 4
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l4, 'A member becomes severely disruptive during a ride. What is the correct first step?', 'multiple_choice',
   '{"a":"Call dispatch for guidance while driving","b":"Immediately end the app session to avoid a rating","c":"Pull into a well-lit public area, calmly end the trip, and report via Safety screen","d":"Continue to the destination to avoid the conflict"}'::jsonb,
   'c', 'Your safety comes first. Pull over safely, end the trip, and use the Safety screen to report. Do not continue driving in an unsafe situation.', 1),
  (gen_random_uuid(), l4, 'How long do you have to dispute a rating you believe is inaccurate?', 'multiple_choice',
   '{"a":"24 hours","b":"48 hours","c":"72 hours","d":"7 days"}'::jsonb,
   'b', 'Rating disputes must be submitted within 48 hours of the trip. Include the trip ID and specific details. MCC reviews all disputes within 3 business days.', 2),
  (gen_random_uuid(), l4, 'A member who hasn''t appeared after 10 minutes can be marked as a no-show.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'true', 'After the 5-minute free window plus a further 5 minutes, if there has been no contact, you can mark the trip as a no-show. It counts as a completed trip for your metrics.', 3);

END $$;


-- ─── MODULE 3: Solo Vehicle Shuttle (slug = 'solo-vehicle-shuttle') ───────────
DO $$
DECLARE
  mod_id UUID;
  l1 UUID; l2 UUID; l3 UUID; l4 UUID; l5 UUID;
BEGIN
  SELECT id INTO mod_id FROM training_modules WHERE slug = 'solo-vehicle-shuttle';

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'solo-vehicle-handoff', 'Vehicle Handoff & Pre-Drive Inspection', 'text', 1,
    '[
      {"type":"text","body":"In solo vehicle shuttle jobs, you drive the member''s personal vehicle — often a luxury or high-value car. The handoff process is critical."},
      {"type":"step","number":1,"body":"Before accepting the vehicle keys, photograph all four sides of the vehicle plus the interior. Upload these to the Relocation screen immediately. This timestamps the pre-drive condition."},
      {"type":"step","number":2,"body":"Check fuel level, tire pressure (visual check for flats), and dashboard warning lights. Report any pre-existing issues in the app before moving the vehicle."},
      {"type":"step","number":3,"body":"Adjust the seat, mirrors, and steering column for safe driving. Do not adjust anything on the dashboard that the member hasn''t configured."},
      {"type":"step","number":4,"body":"Confirm the destination with the member or dispatcher. Never assume — a wrong address for a vehicle shuttle can be very costly."},
      {"type":"important","body":"Never smoke, eat, drink (other than water), or allow any other person into the member''s vehicle during a solo shuttle job."},
      {"type":"warning","body":"If you discover undisclosed damage during inspection, photograph it and contact dispatch before moving the vehicle. Do not proceed without documented acknowledgment."}
    ]'::jsonb
  ) RETURNING id INTO l1;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'solo-vehicle-driving', 'Driving & Handling Member Vehicles', 'text', 2,
    '[
      {"type":"text","body":"Different vehicles handle differently. A luxury sedan, SUV, or sports car requires adjustment in driving style to protect the member''s asset."},
      {"type":"text","body":"Acceleration: Drive smoothly. No hard acceleration or sudden braking. Performance vehicles respond quickly — treat throttle and brake inputs as delicate."},
      {"type":"text","body":"Parking: For vehicles with low clearance or large dimensions, choose spaces carefully. Avoid tight parallel parking unless you are fully confident. Better to walk further than risk a curb scrape."},
      {"type":"text","body":"Navigation: Use the in-app GPS, not the vehicle''s built-in nav. Do not pair your phone to the vehicle''s Bluetooth or access any vehicle media systems."},
      {"type":"important","body":"Your MCC driver insurance applies while operating the member''s vehicle on an active job. However, your personal auto insurance does NOT cover you for platform work. Never use the vehicle for personal errands during a job."},
      {"type":"tip","body":"If you''re unfamiliar with the vehicle (e.g., first time driving a specific EV), take 60 seconds in a safe area to understand the gear selector, regenerative braking, and any unusual controls before entering traffic."},
      {"type":"scenario","title":"Scenario: The vehicle''s fuel light comes on en route","body":"Contact dispatch immediately. Do not add fuel without explicit member authorization and a fuel receipt. Some members prefer specific fuel grades. Dispatch will relay instructions."}
    ]'::jsonb
  ) RETURNING id INTO l2;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'solo-vehicle-delivery', 'Vehicle Delivery and Final Handoff', 'text', 3,
    '[
      {"type":"text","body":"Delivering the vehicle in perfect condition and completing the post-drive handoff properly closes the job and protects you from damage claims."},
      {"type":"step","number":1,"body":"Park the vehicle in the agreed location. Confirm parking legality — do not park in a loading zone, fire lane, or tow-away zone."},
      {"type":"step","number":2,"body":"Photograph the vehicle again from all four sides and the interior before exiting. This is your post-drive condition record."},
      {"type":"step","number":3,"body":"Lock the vehicle and confirm key security. For key drop-offs (valet boxes, concierge desks), get a written or digital receipt."},
      {"type":"step","number":4,"body":"In the app, mark the job complete and attach your post-drive photos. The system will compare pre- and post-drive records."},
      {"type":"tip","body":"Return the seat, mirrors, and steering column to approximately where you found them. Members appreciate this small courtesy and it can prevent a complaint."},
      {"type":"warning","body":"If you cannot safely park at the designated location (blocked, full, unsafe), call dispatch before making any alternative arrangement. Do not park in an unapproved location without documented authorization."}
    ]'::jsonb
  ) RETURNING id INTO l3;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'solo-vehicle-incidents', 'Incidents and Emergency Procedures', 'text', 4,
    '[
      {"type":"text","body":"Operating a member''s vehicle comes with elevated responsibility. Knowing exactly how to handle incidents protects the member, you, and your driver status."},
      {"type":"text","body":"Minor incident (curb scrape, parking ding): Stop immediately. Photograph the damage. Call dispatch and do not move the vehicle until instructed. Do not attempt to handle it directly with the third party."},
      {"type":"text","body":"Major accident: Ensure safety first. Call 911 if anyone is injured. Do not admit fault. Preserve the scene. Contact dispatch immediately from a safe location. MCC''s insurance team will be notified automatically."},
      {"type":"text","body":"Mechanical failure: If a warning light appears or the vehicle behaves abnormally, pull over safely. Never drive a malfunctioning vehicle. Call dispatch for tow coordination."},
      {"type":"important","body":"Any incident must be reported to dispatch within 15 minutes of occurrence, regardless of severity. Delayed reporting is grounds for a deactivation review."},
      {"type":"tip","body":"Keep dispatch''s contact number saved as a favorite so you can reach them hands-free via voice command during stressful situations."}
    ]'::jsonb
  ) RETURNING id INTO l4;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'solo-vehicle-valet', 'Valet and Concierge Drop-Off Etiquette', 'text', 5,
    '[
      {"type":"text","body":"Many solo shuttle destinations are hotels, private clubs, or valet facilities. Professional etiquette at these locations reflects on MCC and the member."},
      {"type":"step","number":1,"body":"Approach the valet or concierge desk in professional attire. Present the MCC driver ID on your phone when asked for identification."},
      {"type":"step","number":2,"body":"Communicate clearly: state the member''s name, vehicle, and any specific parking instructions provided by dispatch."},
      {"type":"step","number":3,"body":"Obtain a physical or digital valet ticket and photograph it before leaving. Upload to the job record."},
      {"type":"step","number":4,"body":"Tip the valet only if authorized and covered in the job budget confirmed by dispatch. Never tip from your own funds unless instructed."},
      {"type":"tip","body":"When in doubt at a valet stand, say less, not more. ''Delivering this vehicle for [member name], here are the keys'' is sufficient."},
      {"type":"scenario","title":"Scenario: The valet refuses to accept the vehicle without the owner present","body":"Call dispatch immediately and stay with the vehicle. Do not leave it unattended. Dispatch will coordinate directly with the member to resolve authorization."}
    ]'::jsonb
  ) RETURNING id INTO l5;

  -- Questions for Lesson 1
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l1, 'What must you do before accepting a member''s vehicle keys?', 'multiple_choice',
   '{"a":"Test-drive the vehicle to check handling","b":"Photograph all four sides and interior and upload to the app","c":"Confirm the vehicle''s insurance coverage","d":"Call dispatch to verify the member''s identity"}'::jsonb,
   'b', 'Pre-drive photos are timestamped evidence of the vehicle''s pre-existing condition. This protects you from false damage claims.', 1),
  (gen_random_uuid(), l1, 'You discover a scratch on the hood that wasn''t mentioned in the job notes. You should:', 'multiple_choice',
   '{"a":"Proceed — minor pre-existing damage doesn''t need reporting","b":"Photograph it and contact dispatch before moving the vehicle","c":"Note it in the post-drive photos only","d":"Alert the member directly and ask how they''d like to proceed"}'::jsonb,
   'b', 'Undisclosed pre-existing damage must be documented and acknowledged by dispatch before you move the vehicle. Proceeding without this creates liability.', 2),
  (gen_random_uuid(), l1, 'You can allow a friend to ride with you briefly in the member''s vehicle as long as they don''t touch anything.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'No unauthorized person may enter the member''s vehicle under any circumstances during a solo shuttle job. This is grounds for immediate deactivation.', 3);

  -- Questions for Lesson 2
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l2, 'Which navigation method should you use when driving a member''s vehicle?', 'multiple_choice',
   '{"a":"The vehicle''s built-in GPS","b":"The MCC in-app GPS on your phone","c":"Memory, since using devices while driving is unsafe","d":"The member''s saved routes in the vehicle''s system"}'::jsonb,
   'b', 'Use the MCC in-app GPS. Do not access or pair to the vehicle''s built-in systems — this maintains the member''s privacy and avoids unwanted changes to their settings.', 1),
  (gen_random_uuid(), l2, 'Your personal auto insurance covers you when driving a member''s vehicle on a platform job.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Personal auto insurance explicitly excludes commercial/platform work. MCC driver insurance covers you for the duration of active jobs. Never use the vehicle for personal errands.', 2),
  (gen_random_uuid(), l2, 'The fuel light comes on while driving a member''s vehicle. What do you do?', 'multiple_choice',
   '{"a":"Add fuel and submit the receipt later","b":"Continue to the destination — it''s likely fine","c":"Contact dispatch immediately and await fuel grade and authorization instructions","d":"Pull over and wait for the member to arrange fuel delivery"}'::jsonb,
   'c', 'Some vehicles require specific fuel grades. Always get explicit authorization and instructions from dispatch before adding fuel to a member''s vehicle.', 3);

  -- Questions for Lesson 3
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l3, 'What should you do immediately after parking the member''s vehicle at the destination?', 'multiple_choice',
   '{"a":"Mark the job complete in the app immediately","b":"Photograph the vehicle from all four sides and interior, then mark complete","c":"Call the member to confirm arrival","d":"Leave the keys with the nearest staff member"}'::jsonb,
   'b', 'Post-drive photos close the condition record. Only then should you mark the job complete. The system compares pre- and post-drive photos.', 1),
  (gen_random_uuid(), l3, 'The designated parking spot is in a tow-away zone. You should:', 'multiple_choice',
   '{"a":"Park there briefly and move when the member arrives","b":"Call dispatch before making any alternative arrangement","c":"Find the nearest legal spot and move the vehicle","d":"Park there and set a phone timer to check every 10 minutes"}'::jsonb,
   'b', 'Never park in an unapproved location without documented authorization from dispatch. Contact them before making any deviation from the plan.', 2);

  -- Questions for Lesson 4
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l4, 'You are involved in a minor incident while driving a member''s vehicle. What is the time limit for reporting it to dispatch?', 'multiple_choice',
   '{"a":"End of the shift","b":"24 hours","c":"15 minutes","d":"As soon as you feel emotionally ready"}'::jsonb,
   'c', 'All incidents must be reported to dispatch within 15 minutes of occurrence. Delayed reporting is a policy violation and grounds for a deactivation review.', 1),
  (gen_random_uuid(), l4, 'At the scene of a major accident, you should admit fault to prevent escalation.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Never admit fault at an accident scene. Ensure safety, call 911 if needed, preserve the scene, and contact dispatch. MCC''s insurance team handles liability.', 2),
  (gen_random_uuid(), l4, 'A dashboard warning light appears while driving. You should:', 'multiple_choice',
   '{"a":"Continue to the destination and report after","b":"Ignore minor warning lights — they''re often maintenance reminders","c":"Pull over safely and contact dispatch for tow coordination","d":"Add oil or coolant as appropriate and continue"}'::jsonb,
   'c', 'Never drive a malfunctioning vehicle. Pull over safely, do not attempt repairs, and contact dispatch. MCC handles tow coordination.', 3);

  -- Questions for Lesson 5
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l5, 'When checking in at a valet stand, which identification should you present?', 'multiple_choice',
   '{"a":"Your personal driver''s license","b":"A business card with your contact info","c":"Your MCC driver ID displayed on your phone","d":"The member''s name on a handwritten note"}'::jsonb,
   'c', 'Present your MCC driver ID from your phone. This is the official credential that valet and concierge staff recognize from MCC-trained drivers.', 1),
  (gen_random_uuid(), l5, 'You should always tip the valet from your own funds to maintain good relations.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Only tip if explicitly authorized and covered in the job budget confirmed by dispatch. Never tip from your personal funds unless specifically instructed.', 2);

END $$;


-- ─── MODULE 4: Tandem & Concierge (slug = 'tandem-concierge') ────────────────
DO $$
DECLARE
  mod_id UUID;
  l1 UUID; l2 UUID; l3 UUID; l4 UUID;
BEGIN
  SELECT id INTO mod_id FROM training_modules WHERE slug = 'tandem-concierge';

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'tandem-how-it-works', 'How Tandem Jobs Work', 'text', 1,
    '[
      {"type":"text","body":"Tandem jobs involve two drivers working in coordination to relocate a member''s vehicle while transporting the member (or their belongings) separately. These are higher-complexity, higher-pay jobs."},
      {"type":"text","body":"Primary Driver: Drives the member''s personal vehicle from Point A to Point B. Acts as the lead."},
      {"type":"text","body":"Chase Driver (Ride-Along Driver): Follows in their own vehicle, provides the return ride for the primary driver after vehicle delivery, and coordinates logistics."},
      {"type":"step","number":1,"body":"Both drivers receive the same job offer simultaneously. The first to accept is designated primary; the second is chase. Role assignments are confirmed in the app."},
      {"type":"step","number":2,"body":"Primary and chase drivers should establish contact via the in-app messaging before departing. Confirm pickup time, meeting point, and destination."},
      {"type":"step","number":3,"body":"Primary departs with the member''s vehicle. Chase follows at a safe distance, staying visible but not tailgating."},
      {"type":"step","number":4,"body":"At delivery, primary completes the vehicle handoff. Chase picks up the primary driver and returns. Both drivers complete their app records independently."},
      {"type":"tip","body":"The in-app tandem chat is your primary coordination channel. Avoid external messaging apps for job-related communication — all records must stay on-platform."},
      {"type":"warning","body":"If your chase driver fails to arrive at the meeting point within 10 minutes of the agreed time, contact dispatch. Do not start the job without your tandem partner confirmed."}
    ]'::jsonb
  ) RETURNING id INTO l1;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'tandem-coordination', 'Tandem Communication & Coordination', 'text', 2,
    '[
      {"type":"text","body":"Tandem job success depends almost entirely on communication. Pre-job coordination prevents 95% of problems."},
      {"type":"text","body":"Before departure: Confirm pickup time, exact meeting point (address, not just ''the parking lot''), and any special member instructions."},
      {"type":"text","body":"En route: Chase driver updates primary if there are traffic issues that might affect timing. Primary updates chase of any route deviations."},
      {"type":"text","body":"At delivery: Chase arrives before or simultaneously with primary. Primary should not be left waiting at an unfamiliar delivery location."},
      {"type":"important","body":"Never leave the primary driver stranded at the delivery location. The entire tandem fee structure is built on both drivers completing the round trip. An incomplete return is a failed job."},
      {"type":"scenario","title":"Scenario: Chase driver gets a flat tire en route","body":"Chase notifies primary immediately via in-app message. Primary pauses at the next safe stopping point. Both contact dispatch for coordination. Dispatch may arrange a replacement chase driver or authorize a rideshare return for the primary."},
      {"type":"tip","body":"Set a shared ETA before departing. If your chase driver is 5+ minutes behind schedule, a quick in-app message prevents the primary from waiting without context."}
    ]'::jsonb
  ) RETURNING id INTO l2;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'tandem-concierge-full', 'Full Concierge Jobs', 'text', 3,
    '[
      {"type":"text","body":"Tier 4 Full Concierge jobs are MCC''s premium offering. They involve multi-step logistics and the highest member expectations on the platform."},
      {"type":"text","body":"Typical full concierge job: Drive member to appointment; return their vehicle to a mechanic or detail shop; wait (paid) for the service to complete; retrieve the vehicle; deliver to a new location."},
      {"type":"text","body":"Job briefs: Full concierge jobs come with a detailed brief in the app. Read the entire brief before accepting — these jobs are not improvised."},
      {"type":"step","number":1,"body":"Review the job brief thoroughly. Note all stops, timing, and any special instructions (gate codes, staff contacts, parking specifications)."},
      {"type":"step","number":2,"body":"Confirm each stop in-app as you complete it. Never skip a check-in — this is how the member and dispatcher track progress."},
      {"type":"step","number":3,"body":"If a vendor (mechanic, detailer, valet) tells you the vehicle won''t be ready at the scheduled time, notify dispatch immediately. Do not improvise a new schedule on your own."},
      {"type":"important","body":"Full concierge jobs pay a higher flat rate plus per-mile. Wait time is compensated. Do not rush to skip wait-time steps — they are built into the job."},
      {"type":"tip","body":"Bring a charger, snacks, and something to do. Wait times on full concierge jobs can run 30–90 minutes. Being comfortable helps you stay professional."}
    ]'::jsonb
  ) RETURNING id INTO l3;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'tandem-member-interaction', 'Member Interaction on Concierge Jobs', 'text', 4,
    '[
      {"type":"text","body":"On concierge jobs, you interact more closely and for longer periods with members. The standard of professionalism is higher."},
      {"type":"text","body":"Updates: Proactively update the member at each milestone (''Your vehicle is now at the detail shop — estimated ready time is 2:30pm''). Members on concierge jobs expect communication, not silence."},
      {"type":"text","body":"Problem escalation: If anything deviates from the job brief, update the member AND dispatch simultaneously. Never tell the member you''re handling something before checking with dispatch."},
      {"type":"text","body":"Personal information: Concierge jobs sometimes place you at members'' homes or private locations. Treat all location information, scheduling information, and personal details as strictly confidential."},
      {"type":"important","body":"No photographs of member properties, belongings, or family members. Ever. This is grounds for immediate and permanent deactivation."},
      {"type":"scenario","title":"Scenario: The member asks you to handle a personal errand while you''re waiting (''just pick up a package next door'')","body":"Politely decline and note that any additional stops require a new service request through the MCC app. You cannot improvise out-of-scope tasks, even if small. ''I''d need to have dispatch authorize that as an add-on to avoid any coverage gaps.''"},
      {"type":"tip","body":"A short, professional status update every 30–45 minutes on long concierge jobs is appreciated. Keep it factual: time, location, status. No editorializing."}
    ]'::jsonb
  ) RETURNING id INTO l4;

  -- Questions Lesson 1
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l1, 'In a tandem job, what is the primary driver responsible for?', 'multiple_choice',
   '{"a":"Following the chase driver and providing navigation","b":"Driving the member''s personal vehicle from Point A to Point B","c":"Transporting the member in their own vehicle","d":"Coordinating all logistics and communicating with dispatch"}'::jsonb,
   'b', 'The primary driver operates the member''s vehicle. The chase driver follows in their own vehicle and provides the return ride for the primary after delivery.', 1),
  (gen_random_uuid(), l1, 'You should start a tandem job alone if your chase driver is 5 minutes late.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Do not start a tandem job without your partner confirmed. If your chase driver is 10+ minutes late, contact dispatch. Starting alone leaves you stranded at the delivery location.', 2),
  (gen_random_uuid(), l1, 'Which communication channel should you use for tandem job coordination?', 'multiple_choice',
   '{"a":"Personal text messages","b":"WhatsApp or similar messaging app","c":"The in-app tandem chat","d":"Phone calls only"}'::jsonb,
   'c', 'All job-related communication must stay on-platform via the in-app tandem chat. This keeps records accessible to dispatch and supports any dispute resolution.', 3);

  -- Questions Lesson 2
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l2, 'The chase driver gets a flat tire en route. What should happen?', 'multiple_choice',
   '{"a":"Primary continues to the destination and waits","b":"Chase notifies primary, both contact dispatch, primary pauses at a safe stopping point","c":"Primary returns to pick up the chase driver","d":"The job is automatically cancelled"}'::jsonb,
   'b', 'Communication and dispatch coordination are the correct response. Dispatch may arrange a replacement or authorize alternatives. Primary should not proceed alone.', 1),
  (gen_random_uuid(), l2, 'Leaving the primary driver stranded at the delivery location is acceptable if an emergency prevents the chase driver from completing the return.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Leaving the primary stranded is a failed job. Chase drivers must contact dispatch immediately if they cannot complete the return so alternatives can be arranged.', 2),
  (gen_random_uuid(), l2, 'When should the chase driver arrive at the delivery location?', 'multiple_choice',
   '{"a":"After the primary has completed the handoff","b":"Before or simultaneously with the primary","c":"It doesn''t matter as long as they arrive within 30 minutes","d":"The chase driver waits at the pickup location"}'::jsonb,
   'b', 'Chase should arrive before or simultaneously with primary. The primary should never be left waiting alone at an unfamiliar delivery location.', 3);

  -- Questions Lesson 3
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l3, 'A vendor tells you the member''s vehicle won''t be ready at the scheduled time. What do you do?', 'multiple_choice',
   '{"a":"Adjust the schedule yourself and update the member","b":"Wait silently and update everyone when the vehicle is actually ready","c":"Notify dispatch immediately — do not improvise a new schedule","d":"Contact the member directly and skip dispatch"}'::jsonb,
   'c', 'Any deviation from the job brief must go through dispatch immediately. Never improvise a new schedule independently — dispatch coordinates with the member.', 1),
  (gen_random_uuid(), l3, 'On a full concierge job, wait time between stops is not compensated.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Wait time on full concierge jobs IS compensated. Do not rush through or skip wait-time steps — they are built into the job and paid accordingly.', 2);

  -- Questions Lesson 4
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l4, 'A member asks you to pick up a package next door while you''re waiting on a concierge job. You should:', 'multiple_choice',
   '{"a":"Do it — small favors build loyalty","b":"Politely decline and explain that any additional stops require dispatch authorization","c":"Do it if it takes less than 5 minutes","d":"Ask the member to submit a new request, then accept it immediately"}'::jsonb,
   'b', 'You cannot improvise out-of-scope tasks. Politely decline and note that any additions require dispatch authorization to maintain coverage and records.', 1),
  (gen_random_uuid(), l4, 'You may photograph a member''s home or property during a concierge job to document the condition for your records.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'No photographs of member properties, belongings, or family members under any circumstances. This is grounds for immediate permanent deactivation.', 2),
  (gen_random_uuid(), l4, 'How often should you proactively update the member during a long concierge job?', 'multiple_choice',
   '{"a":"Only when something goes wrong","b":"Every 30-45 minutes with a brief factual status update","c":"At the start and end only","d":"Whenever you feel like it"}'::jsonb,
   'b', 'Proactive updates every 30–45 minutes keep members informed and build confidence. Keep updates factual: time, location, status.', 3);

END $$;


-- ─── MODULE 5: Safety & Emergency (slug = 'safety-emergency') ────────────────
DO $$
DECLARE
  mod_id UUID;
  l1 UUID; l2 UUID; l3 UUID; l4 UUID;
BEGIN
  SELECT id INTO mod_id FROM training_modules WHERE slug = 'safety-emergency';

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'safety-personal', 'Personal Safety Best Practices', 'text', 1,
    '[
      {"type":"text","body":"Your personal safety on every job is non-negotiable. The MCC Safety screen exists because we take this seriously. Use it."},
      {"type":"text","body":"Trip sharing: For every job, share your live trip link with a trusted contact. The Safety screen generates this instantly. This is especially important for late-night and solo vehicle jobs."},
      {"type":"text","body":"Emergency contact: Set your emergency contact in the Safety screen. In an SOS event, MCC will attempt to reach this person automatically."},
      {"type":"text","body":"Trust your instincts: If a situation feels wrong before or during a job, it probably is. You have the right to decline any job offer or end any active trip that feels unsafe."},
      {"type":"important","body":"The SOS button in the Navigate screen sends your GPS coordinates, job details, and a distress signal to MCC dispatch and (if configured) local emergency services. Use it without hesitation if you feel threatened."},
      {"type":"tip","body":"Keep your phone charged above 20% at all times during active hours. A dead phone in an emergency is a serious risk. Use a car mount and charger."},
      {"type":"warning","body":"Do not drive fatigued. If you feel drowsy, go offline and rest. Fatigue-related incidents are treated the same as at-fault accidents."}
    ]'::jsonb
  ) RETURNING id INTO l1;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'safety-accident', 'Accident and Incident Response', 'text', 2,
    '[
      {"type":"text","body":"Accidents are rare, but knowing how to respond correctly protects everyone involved and keeps you in good standing with MCC."},
      {"type":"step","number":1,"body":"Ensure safety first. If the vehicle is drivable and in a hazardous position (blocking traffic), move it to the shoulder or a safe nearby area if it is safe to do so."},
      {"type":"step","number":2,"body":"Check for injuries. Call 911 immediately if anyone is injured, regardless of fault or incident severity."},
      {"type":"step","number":3,"body":"Do not admit fault. Exchange insurance and contact information with the other party but say nothing about who caused the incident."},
      {"type":"step","number":4,"body":"Photograph the scene: both vehicles, road conditions, any relevant signage, and the other party''s license plate and insurance card."},
      {"type":"step","number":5,"body":"Call MCC dispatch within 15 minutes. They will connect you with the insurance team. Do not leave the scene before dispatch confirms you can."},
      {"type":"important","body":"If a passenger is present during an accident, your first priority is their safety and calm. Speak reassuringly, check if they are injured, and do not begin insurance proceedings in front of them."}
    ]'::jsonb
  ) RETURNING id INTO l2;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'safety-medical', 'Medical Emergencies & First Aid Basics', 'text', 3,
    '[
      {"type":"text","body":"Medical emergencies in a vehicle are terrifying but manageable if you stay calm and act systematically."},
      {"type":"text","body":"Passenger medical emergency: Pull over immediately in the safest available location. Call 911. Stay with the passenger and follow dispatcher instructions. Do not attempt to drive to a hospital — emergency services are faster."},
      {"type":"text","body":"Choking: If a passenger is choking, pull over, call 911, and perform the Heimlich maneuver if you are trained. Keep dispatch informed."},
      {"type":"text","body":"Unconscious passenger: Do not move them unless there is immediate danger (fire, water). Call 911 and keep the passenger''s airway clear. Wait for emergency services."},
      {"type":"tip","body":"Consider completing a basic First Aid/CPR certification. It''s not required by MCC but is strongly encouraged and may qualify you for safety incentives."},
      {"type":"important","body":"After any medical incident involving a member, file a Safety screen report immediately, even if the member insists they are fine. This is for your protection."},
      {"type":"scenario","title":"Scenario: Your passenger says they feel faint and asks you not to call 911","body":"Their request does not override your duty of care. Pull over, assess the situation, and if there is any doubt about their safety, call 911. A trip to the ER they didn''t want is vastly preferable to a trip they needed and didn''t get."}
    ]'::jsonb
  ) RETURNING id INTO l3;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'safety-vehicle-prep', 'Vehicle Safety Preparation', 'text', 4,
    '[
      {"type":"text","body":"A well-maintained vehicle is a safe vehicle. MCC''s document requirements exist because safety starts before you leave the driveway."},
      {"type":"text","body":"Monthly checks: Tire pressure (including spare), brake fluid, engine oil, windshield washer fluid. These take 10 minutes and prevent breakdowns."},
      {"type":"text","body":"Emergency kit: Keep a basic kit in your trunk — jumper cables or jump starter, reflective triangles, a flashlight, a first aid kit, and a phone charger."},
      {"type":"text","body","body":"Tire blowout: If a tire blows at speed, grip the wheel firmly, do NOT brake hard, ease off the accelerator, and steer to the shoulder gradually. Once slow and safe, use hazard lights."},
      {"type":"important","body":"Your vehicle must pass MCC''s annual inspection to remain on the platform. Expired inspection stickers or failing brakes are grounds for immediate suspension from the platform."},
      {"type":"tip","body":"Keep reflective triangles or road flares in your trunk. If you break down, deploying them behind your vehicle dramatically reduces the risk of being rear-ended while waiting for help."}
    ]'::jsonb
  ) RETURNING id INTO l4;

  -- Questions Lesson 1
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l1, 'What does the SOS button in the Navigate screen do?', 'multiple_choice',
   '{"a":"Calls the member to check in","b":"Sends GPS coordinates and job details to dispatch and optionally emergency services","c":"Pauses the ride timer","d":"Alerts the nearest MCC driver to assist"}'::jsonb,
   'b', 'The SOS button sends a distress signal with your GPS coordinates and job context to dispatch and, if configured, local emergency services. Use it without hesitation.', 1),
  (gen_random_uuid(), l1, 'You feel drowsy during a late shift. The best action is:', 'multiple_choice',
   '{"a":"Open the windows and turn up music to stay alert","b":"Drink a large coffee and push through the shift","c":"Go offline and rest","d":"Ask dispatch to send shorter-distance jobs"}'::jsonb,
   'c', 'Driving fatigued is dangerous and treated the same as at-fault incidents. Go offline and rest — your safety and others'' lives are more important than shift earnings.', 2),
  (gen_random_uuid(), l1, 'Trip sharing via the Safety screen is optional and only recommended for late-night jobs.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Trip sharing is recommended for every job. It takes seconds and provides a critical safety net for any unexpected situation, day or night.', 3);

  -- Questions Lesson 2
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l2, 'After a minor fender-bender, you should admit fault to keep things simple.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Never admit fault. Exchange information and contact dispatch. Fault determination is handled by the insurance teams with full information — not at the roadside in the moment.', 1),
  (gen_random_uuid(), l2, 'A passenger is in your car during an accident. Your first priority is:', 'multiple_choice',
   '{"a":"Calling MCC dispatch","b":"Photographing the damage","c":"The passenger''s safety and calm","d":"Exchanging insurance with the other driver"}'::jsonb,
   'c', 'Passenger safety and wellbeing comes first. Speak reassuringly, check for injuries, and do not begin insurance proceedings in front of them.', 2),
  (gen_random_uuid(), l2, 'You must contact dispatch within how many minutes of an incident?', 'multiple_choice',
   '{"a":"30 minutes","b":"1 hour","c":"15 minutes","d":"End of the shift"}'::jsonb,
   'c', 'All incidents must be reported to dispatch within 15 minutes. Delayed reporting is a policy violation.', 3);

  -- Questions Lesson 3
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l3, 'A passenger feels faint and asks you not to call 911. You should:', 'multiple_choice',
   '{"a":"Respect their wishes and drive them home quickly","b":"Pull over, assess the situation, and call 911 if there is any doubt about their safety","c":"Drive to the nearest hospital as fast as possible","d":"Ask them to rate how faint they feel on a scale of 1-10 before deciding"}'::jsonb,
   'b', 'Your duty of care overrides the passenger''s request in cases of potential medical emergency. Pull over, assess, and call 911 if uncertain. A false alarm is always better than an emergency that wasn''t treated.', 1),
  (gen_random_uuid(), l3, 'After any medical incident involving a member, you should file a Safety screen report:', 'multiple_choice',
   '{"a":"Only if the member was transported by ambulance","b":"Only if the member files a complaint first","c":"Immediately, even if the member says they are fine","d":"Within 24 hours if you remember"}'::jsonb,
   'c', 'Always file a Safety screen report immediately after any medical incident, regardless of apparent severity. This protects you from liability and creates a record.', 2);

  -- Questions Lesson 4
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l4, 'What is the correct response to a tire blowout at highway speed?', 'multiple_choice',
   '{"a":"Brake hard immediately to slow down","b":"Grip the wheel firmly, ease off the accelerator, steer to the shoulder gradually","c":"Accelerate briefly to stabilize before braking","d":"Turn on hazard lights and brake moderately"}'::jsonb,
   'b', 'Hard braking during a blowout can cause a spin-out. Grip the wheel, ease off the gas, and steer gently to the shoulder. Once slow, activate hazards.', 1),
  (gen_random_uuid(), l4, 'An expired vehicle inspection sticker is acceptable if the vehicle seems to be running fine.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Expired inspections or failing brakes are grounds for immediate platform suspension. Compliance is non-negotiable, not a judgment call.', 2);

END $$;


-- ─── MODULE 6: Earnings & Business (slug = 'earnings-business') ──────────────
DO $$
DECLARE
  mod_id UUID;
  l1 UUID; l2 UUID; l3 UUID; l4 UUID;
BEGIN
  SELECT id INTO mod_id FROM training_modules WHERE slug = 'earnings-business';

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'earnings-how-pay-works', 'How Driver Pay Works', 'text', 1,
    '[
      {"type":"text","body":"Understanding your pay structure helps you make smart decisions about which jobs to accept, when to work, and how to maximize earnings."},
      {"type":"text","body":"Base fare: 85% of the member-facing fare. The base fare includes a per-mile rate that increases with tier, plus a per-minute rate for rideshare and delivery jobs."},
      {"type":"text","body":"Tips: 100% of all tips go directly to you with no platform deduction. Tips appear in your wallet within 2 hours of the member submitting them."},
      {"type":"text","body":"Promotions and quests: Active promotions (e.g., ''Complete 10 rides this week for a $50 bonus'') stack on top of your base earnings. Check the Promotions screen regularly."},
      {"type":"text","body":"Wait time fees: After the 5-minute grace period on passenger jobs, a per-minute wait fee accrues and is added to the fare automatically."},
      {"type":"important","body":"The Earnings screen shows a full breakdown by job, including base fare, tips, wait time, and promotion bonuses. Review it weekly to verify your pay."},
      {"type":"tip","body":"The highest-earning drivers work consistent hours and maintain high acceptance rates during peak periods. Sporadic, high-decline patterns earn less even at the same hours."}
    ]'::jsonb
  ) RETURNING id INTO l1;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'earnings-payouts', 'Payouts, Taxes, and Financial Planning', 'text', 2,
    '[
      {"type":"text","body":"Managing your earnings well is as important as earning them. As an independent contractor on the MCC platform, you are responsible for your own taxes."},
      {"type":"text","body":"Payout options: Standard payout (1-2 business days, free) or Instant payout (minutes, 1.5% fee). Both require a connected bank account or debit card via the Payments settings."},
      {"type":"text","body":"Taxes: MCC does not withhold taxes. You receive a 1099-NEC at year-end if you earn over $600. Set aside 25-30% of gross earnings for taxes. Many drivers pay quarterly estimated taxes to avoid a large year-end bill."},
      {"type":"text","body":"Deductible expenses: Vehicle mileage (standard or actual method), phone plan (business percentage), car washes, and accessories used for work are common deductions. Keep records."},
      {"type":"important","body":"Do not treat your MCC wallet balance as your take-home pay. Account for taxes and vehicle expenses — your true hourly rate after all costs is your real income."},
      {"type":"tip","body":"Use a separate bank account or savings account for your MCC income. Automatically transfer 25% of each payout to it for taxes. This simple habit prevents painful tax season surprises."}
    ]'::jsonb
  ) RETURNING id INTO l2;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'earnings-promotions-strategy', 'Promotion Strategy & Quest Completion', 'text', 3,
    '[
      {"type":"text","body":"Promotions and quests are structured bonuses designed to reward high-quality, consistent work. Understanding how they''re structured lets you plan around them."},
      {"type":"text","body":"Ride count quests: ''Complete X rides'' quests reward volume. Best completed during your scheduled online hours rather than spontaneous short sessions."},
      {"type":"text","body":"Rating quests: ''Maintain a 4.8+ rating for 20 rides'' quests reward quality. Accept only jobs you can execute well — a single 3-star rating on a quest window can reset it."},
      {"type":"text","body":"Scheduled shift bonuses: Some promotions pay a guaranteed minimum for completing a full scheduled shift. These protect your earnings during slow periods."},
      {"type":"text","body":"How to find active promotions: Promotions screen (Settings → Driver Tools → Promotions) shows your progress on every active quest."},
      {"type":"tip","body":"Stack promotions strategically. A ride-count quest + a shift bonus during a high-demand evening = maximum earnings per hour. Plan your schedule around active promotions."},
      {"type":"warning","body":"Do not accept rides you plan to perform poorly on just to hit a quest count. A 1-star rating costs you more in long-term dispatch priority than a single quest bonus is worth."}
    ]'::jsonb
  ) RETURNING id INTO l3;

  INSERT INTO training_lessons (id, module_id, slug, title, content_type, sort_order, content)
  VALUES (
    gen_random_uuid(), mod_id, 'earnings-vehicle-costs', 'Vehicle Costs & Long-Term Driver Economics', 'text', 4,
    '[
      {"type":"text","body":"Your vehicle is your most important business asset. Managing its costs intelligently determines whether driving for MCC is profitable long-term."},
      {"type":"text","body":"Mileage and depreciation: High-mileage driving accelerates depreciation. Calculate your true cost-per-mile (IRS standard rate or actual method) and compare it to your earnings-per-mile."},
      {"type":"text","body":"Maintenance schedule: Platform work accelerates wear on brakes, tires, and oil. Follow your vehicle''s maintenance intervals strictly — deferred maintenance compounds into expensive repairs."},
      {"type":"text","body":"Fuel efficiency: Smooth driving, proper tire inflation, and AC management can improve fuel economy by 5–15%. At platform scale (50,000+ annual miles), this is meaningful."},
      {"type":"text","body":"Vehicle replacement planning: If you plan to drive for MCC long-term, budget for a vehicle replacement cycle. Many experienced drivers set aside $0.10–0.15 per mile toward a replacement fund."},
      {"type":"important","body":"A reliable, well-maintained vehicle is the foundation of your business. Skipping a $50 oil change to save money can turn into a $5,000 engine repair that sidelines you for weeks."},
      {"type":"tip","body":"Track your annual mileage by tier job type. Tier 3/4 jobs typically pay more per mile — understanding your earning-per-mile by tier helps you decide whether to pursue additional certifications."}
    ]'::jsonb
  ) RETURNING id INTO l4;

  -- Questions Lesson 1
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l1, 'What percentage of tips do you receive?', 'multiple_choice',
   '{"a":"70%","b":"85%","c":"95%","d":"100%"}'::jsonb,
   'd', 'Tips are always 100% yours with no platform deduction. They appear in your wallet within 2 hours of the member submitting them.', 1),
  (gen_random_uuid(), l1, 'Wait time fees begin accruing after how long?', 'multiple_choice',
   '{"a":"2 minutes","b":"5 minutes","c":"10 minutes","d":"They don''t accrue — wait time is not compensated"}'::jsonb,
   'b', 'The first 5 minutes are a free grace period. After that, a per-minute wait fee is automatically added to the fare.', 2),
  (gen_random_uuid(), l1, 'Inconsistent work patterns with high decline rates earn the same hourly rate as consistent, high-acceptance driving.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'High-acceptance, consistent drivers receive dispatch priority, which means more offers per hour. Sporadic, high-decline patterns earn less even at the same clock hours.', 3);

  -- Questions Lesson 2
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l2, 'What is the Instant Payout fee?', 'multiple_choice',
   '{"a":"Free","b":"1%","c":"1.5%","d":"2%"}'::jsonb,
   'c', 'Instant Payout (credited in minutes) costs 1.5%. Standard payout (1-2 business days) is free.', 1),
  (gen_random_uuid(), l2, 'MCC withholds federal income tax from your earnings automatically.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'MCC drivers are independent contractors. No taxes are withheld. You are responsible for quarterly estimated tax payments. Set aside 25-30% of gross earnings.', 2),
  (gen_random_uuid(), l2, 'Which of the following is a deductible business expense for MCC drivers?', 'multiple_choice',
   '{"a":"Clothing worn during rides","b":"Vehicle mileage driven for platform work","c":"Meals eaten during your shift","d":"Personal entertainment subscriptions"}'::jsonb,
   'b', 'Vehicle mileage (standard or actual method), phone plan business percentage, and work-related accessories are common deductible expenses. Meals and clothing are generally not deductible for platform drivers.', 3);

  -- Questions Lesson 3
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l3, 'The best way to maximize earnings during an active ride-count quest is:', 'multiple_choice',
   '{"a":"Accept every single offer regardless of quality","b":"Work consistent scheduled hours during the quest window, maintaining your standard quality","c":"Focus on long-distance jobs only","d":"Accept only Tier 3/4 jobs since they pay more per ride"}'::jsonb,
   'b', 'Consistent scheduled hours with your normal quality standard is the most reliable quest strategy. Don''t sacrifice quality for count — a rating quest reset costs more than a count bonus earns.', 1),
  (gen_random_uuid(), l3, 'Where do you track your progress on active promotions?', 'multiple_choice',
   '{"a":"The Earnings screen","b":"The Home screen only","c":"The Promotions screen in Settings → Driver Tools","d":"The Notifications screen"}'::jsonb,
   'c', 'The Promotions screen (Settings → Driver Tools → Promotions) shows current progress, target, and reward for every active quest.', 2),
  (gen_random_uuid(), l3, 'Accepting jobs you expect to perform poorly on is worth it to hit a quest count target.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'A single poor-service rating costs you more in long-term dispatch priority and potential rating quests than a ride-count bonus earns. Maintain your standards.', 3);

  -- Questions Lesson 4
  INSERT INTO training_questions (id, lesson_id, question_text, question_type, options, correct_answer, explanation, sort_order) VALUES
  (gen_random_uuid(), l4, 'A reliable vehicle is optional for platform driving — you can earn enough to compensate for repair costs.', 'true_false',
   '{"true":"True","false":"False"}'::jsonb,
   'false', 'Your vehicle is your primary business asset. An unreliable vehicle creates downtime, expensive repairs, and potential rating impacts that far outweigh any short-term savings on maintenance.', 1),
  (gen_random_uuid(), l4, 'Which of the following improves fuel economy at platform driving scale?', 'multiple_choice',
   '{"a":"Aggressive acceleration to maintain speed","b":"Smooth driving, proper tire inflation, and smart AC management","c":"Driving at highway speeds for all trips","d":"Using premium fuel in standard vehicles"}'::jsonb,
   'b', 'Smooth driving, proper tire inflation, and strategic AC use can improve fuel economy 5-15%. At 50,000+ annual platform miles, this is a meaningful cost reduction.', 2),
  (gen_random_uuid(), l4, 'Many experienced platform drivers set aside money per mile for:', 'multiple_choice',
   '{"a":"Platform subscription fees","b":"A vehicle replacement fund","c":"Tip increases for members","d":"Marketing their profile"}'::jsonb,
   'b', 'Setting aside $0.10–0.15 per mile toward a vehicle replacement fund is a common practice among experienced platform drivers who plan to continue long-term.', 3);

END $$;
