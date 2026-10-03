-- =============================================================================
-- geography.seed.sql — India: the country, its states and the cities on the
-- busiest intercity bus corridors.
--
-- Part of the system seed (npm run db:seed): routes need an origin and a
-- destination city, and a route's states decide its GST place of supply and
-- the government rules passengers see. State codes are the ISO-style ones
-- the GST rule maps from a GSTIN's first two digits
-- (master-data/domain/gst-state-codes.ts). Safe to run again: existing rows
-- are kept. The super admin adds more cities from the console.
-- =============================================================================

INSERT INTO countries (id, iso2, name, dial_code, currency)
VALUES ('00000000-0000-7000-8000-000000000001', 'IN', 'India', '+91', 'INR')
ON CONFLICT (iso2) DO NOTHING;

INSERT INTO states (id, country_id, code, name) VALUES
  ('00000000-0000-7000-8000-000000000011', '00000000-0000-7000-8000-000000000001', 'DL', 'Delhi'),
  ('00000000-0000-7000-8000-000000000012', '00000000-0000-7000-8000-000000000001', 'RJ', 'Rajasthan'),
  ('00000000-0000-7000-8000-000000000013', '00000000-0000-7000-8000-000000000001', 'KA', 'Karnataka')
ON CONFLICT (country_id, code) DO NOTHING;

INSERT INTO cities (id, state_id, name, latitude, longitude, timezone) VALUES
  ('00000000-0000-7000-8000-000000000021', '00000000-0000-7000-8000-000000000011', 'Delhi', 28.7041, 77.1025, 'Asia/Kolkata'),
  ('00000000-0000-7000-8000-000000000022', '00000000-0000-7000-8000-000000000012', 'Jaipur', 26.9124, 75.7873, 'Asia/Kolkata'),
  ('00000000-0000-7000-8000-000000000023', '00000000-0000-7000-8000-000000000013', 'Bangalore', 12.9716, 77.5946, 'Asia/Kolkata'),
  ('00000000-0000-7000-8000-000000000024', '00000000-0000-7000-8000-000000000013', 'Mysuru', 12.2958, 76.6394, 'Asia/Kolkata'),
  -- Midway towns on Delhi → Jaipur and Bangalore → Mysuru.
  ('00000000-0000-7000-8000-000000000025', '00000000-0000-7000-8000-000000000012', 'Alwar', 27.5530, 76.6346, 'Asia/Kolkata'),
  ('00000000-0000-7000-8000-000000000026', '00000000-0000-7000-8000-000000000013', 'Channapatna', 12.6514, 77.2065, 'Asia/Kolkata')
ON CONFLICT (id) DO NOTHING;

-- The other states, and the cities of the busy corridors in each.
INSERT INTO states (country_id, code, name)
SELECT c.id, s.code, s.name
  FROM countries c
 CROSS JOIN (VALUES
   ('UP', 'Uttar Pradesh'), ('HR', 'Haryana'), ('PB', 'Punjab'), ('CH', 'Chandigarh'),
   ('HP', 'Himachal Pradesh'), ('UT', 'Uttarakhand'), ('MH', 'Maharashtra'), ('GJ', 'Gujarat'),
   ('GA', 'Goa'), ('TG', 'Telangana'), ('AD', 'Andhra Pradesh'), ('TN', 'Tamil Nadu'),
   ('KL', 'Kerala'), ('PY', 'Puducherry'), ('MP', 'Madhya Pradesh'), ('WB', 'West Bengal'),
   ('OR', 'Odisha'), ('BR', 'Bihar'), ('JH', 'Jharkhand'), ('CG', 'Chhattisgarh'),
   ('AS', 'Assam'), ('ML', 'Meghalaya'), ('JK', 'Jammu and Kashmir')
 ) AS s(code, name)
 WHERE c.iso2 = 'IN'
ON CONFLICT (country_id, code) DO NOTHING;

INSERT INTO cities (state_id, name, latitude, longitude, timezone)
SELECT st.id, v.name, v.lat, v.lng, 'Asia/Kolkata'
  FROM (VALUES
    -- North
    ('UP', 'Agra', 27.1767, 78.0081), ('UP', 'Mathura', 27.4924, 77.6737), ('UP', 'Lucknow', 26.8467, 80.9462),
    ('UP', 'Kanpur', 26.4499, 80.3319), ('UP', 'Prayagraj', 25.4358, 81.8463), ('UP', 'Varanasi', 25.3176, 82.9739),
    ('UP', 'Noida', 28.5355, 77.3910), ('UP', 'Bareilly', 28.3670, 79.4304), ('UP', 'Gorakhpur', 26.7606, 83.3732),
    ('HR', 'Gurugram', 28.4595, 77.0266), ('HR', 'Ambala', 30.3782, 76.7767), ('HR', 'Karnal', 29.6857, 76.9905),
    ('PB', 'Ludhiana', 30.9010, 75.8573), ('PB', 'Amritsar', 31.6340, 74.8723), ('PB', 'Jalandhar', 31.3260, 75.5762),
    ('CH', 'Chandigarh', 30.7333, 76.7794),
    ('HP', 'Manali', 32.2432, 77.1892), ('HP', 'Shimla', 31.1048, 77.1734), ('HP', 'Mandi', 31.7080, 76.9318),
    ('HP', 'Dharamshala', 32.2190, 76.3234),
    ('UT', 'Dehradun', 30.3165, 78.0322), ('UT', 'Haridwar', 29.9457, 78.1642), ('UT', 'Rishikesh', 30.0869, 78.2676),
    ('JK', 'Jammu', 32.7266, 74.8570),
    ('RJ', 'Ajmer', 26.4499, 74.6399), ('RJ', 'Jodhpur', 26.2389, 73.0243), ('RJ', 'Udaipur', 24.5854, 73.7125),
    ('RJ', 'Kota', 25.2138, 75.8648),
    -- West
    ('MH', 'Mumbai', 19.0760, 72.8777), ('MH', 'Pune', 18.5204, 73.8567), ('MH', 'Lonavala', 18.7546, 73.4062),
    ('MH', 'Nashik', 19.9975, 73.7898), ('MH', 'Aurangabad', 19.8762, 75.3433), ('MH', 'Kolhapur', 16.7050, 74.2433),
    ('MH', 'Satara', 17.6805, 74.0183), ('MH', 'Solapur', 17.6599, 75.9064), ('MH', 'Nagpur', 21.1458, 79.0882),
    ('MH', 'Shirdi', 19.7645, 74.4762),
    ('GJ', 'Ahmedabad', 23.0225, 72.5714), ('GJ', 'Surat', 21.1702, 72.8311), ('GJ', 'Vadodara', 22.3072, 73.1812),
    ('GJ', 'Rajkot', 22.3039, 70.8022),
    ('GA', 'Panaji', 15.4909, 73.8278),
    ('MP', 'Indore', 22.7196, 75.8577), ('MP', 'Bhopal', 23.2599, 77.4126), ('MP', 'Ujjain', 23.1765, 75.7885),
    -- South
    ('TG', 'Hyderabad', 17.3850, 78.4867), ('TG', 'Warangal', 17.9689, 79.5941), ('TG', 'Suryapet', 17.1405, 79.6200),
    ('AD', 'Vijayawada', 16.5062, 80.6480), ('AD', 'Visakhapatnam', 17.6868, 83.2185), ('AD', 'Rajahmundry', 17.0005, 81.8040),
    ('AD', 'Kurnool', 15.8281, 78.0373), ('AD', 'Anantapur', 14.6819, 77.6006), ('AD', 'Tirupati', 13.6288, 79.4192),
    ('AD', 'Nellore', 14.4426, 79.9865),
    ('KA', 'Mangaluru', 12.9141, 74.8560), ('KA', 'Hassan', 13.0033, 76.1004), ('KA', 'Hubballi', 15.3647, 75.1240),
    ('KA', 'Belagavi', 15.8497, 74.4977), ('KA', 'Davanagere', 14.4644, 75.9218),
    ('TN', 'Chennai', 13.0827, 80.2707), ('TN', 'Vellore', 12.9165, 79.1325), ('TN', 'Krishnagiri', 12.5186, 78.2137),
    ('TN', 'Salem', 11.6643, 78.1460), ('TN', 'Coimbatore', 11.0168, 76.9558), ('TN', 'Tiruchirappalli', 10.7905, 78.7047),
    ('TN', 'Madurai', 9.9252, 78.1198), ('TN', 'Villupuram', 11.9401, 79.4861),
    ('PY', 'Puducherry', 11.9416, 79.8083),
    ('KL', 'Kochi', 9.9312, 76.2673), ('KL', 'Thiruvananthapuram', 8.5241, 76.9366), ('KL', 'Alappuzha', 9.4981, 76.3388),
    ('KL', 'Palakkad', 10.7867, 76.6548), ('KL', 'Kozhikode', 11.2588, 75.7804),
    -- East / North-east
    ('WB', 'Kolkata', 22.5726, 88.3639), ('WB', 'Durgapur', 23.5204, 87.3119), ('WB', 'Siliguri', 26.7271, 88.3953),
    ('OR', 'Bhubaneswar', 20.2961, 85.8245), ('OR', 'Balasore', 21.4942, 86.9335), ('OR', 'Cuttack', 20.4625, 85.8830),
    ('BR', 'Patna', 25.5941, 85.1376), ('BR', 'Gaya', 24.7914, 85.0002),
    ('JH', 'Ranchi', 23.3441, 85.3096), ('JH', 'Dhanbad', 23.7957, 86.4304),
    ('CG', 'Raipur', 21.2514, 81.6296),
    ('AS', 'Guwahati', 26.1445, 91.7362), ('ML', 'Shillong', 25.5788, 91.8933)
  ) AS v(state_code, name, lat, lng)
  JOIN states st ON st.code = v.state_code
 WHERE NOT EXISTS (SELECT 1 FROM cities c WHERE c.name = v.name);
