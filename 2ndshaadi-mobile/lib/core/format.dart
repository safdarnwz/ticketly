import 'package:intl/intl.dart';

/// Labels and formatting shared by every screen (mirrors frontend/src/lib/format.ts).

const marital = {'DIVORCED': 'Divorced', 'WIDOWED': 'Widowed', 'SEPARATED': 'Separated'};
const diets = {
  'VEG': 'Vegetarian',
  'NON_VEG': 'Non-vegetarian',
  'EGGETARIAN': 'Eggetarian',
  'JAIN': 'Jain',
  'VEGAN': 'Vegan',
};
const habits = {'NO': 'No', 'OCCASIONALLY': 'Occasionally', 'YES': 'Yes'};
const childrenPref = {
  'ANY': 'Does not matter',
  'OPEN_TO_CHILDREN': 'Happy if they have children',
  'NO_CHILDREN': 'Prefer no children',
};
const reportReasons = {
  'FAKE_PROFILE': 'Fake profile or photos',
  'ALREADY_MARRIED': 'Seems to be already married',
  'SCAM': 'Asking for money or bank details',
  'HARASSMENT': 'Harassment or threats',
  'INAPPROPRIATE': 'Inappropriate content',
  'OTHER': 'Something else',
};
const religions = [
  'Hindu',
  'Muslim',
  'Christian',
  'Sikh',
  'Jain',
  'Buddhist',
  'Parsi',
  'Jewish',
  'No religion',
  'Other',
];
const languages = [
  'Hindi',
  'Bengali',
  'Marathi',
  'Telugu',
  'Tamil',
  'Gujarati',
  'Urdu',
  'Kannada',
  'Odia',
  'Malayalam',
  'Punjabi',
  'Assamese',
  'Konkani',
  'Sindhi',
  'Kashmiri',
  'Nepali',
  'English',
  'Other',
];
const states = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];

/// 168 → 5′ 6″
String? height(int? cm) {
  if (cm == null || cm <= 0) return null;
  final inches = (cm / 2.54).round();
  return '${inches ~/ 12}′ ${inches % 12}″';
}

/// Heights offered in pickers: 4′6″ to 7′ in one-inch steps.
final List<int> heightOptions = () {
  final out = <int>[];
  for (var i = 0; i < 61; i++) {
    final cm = (137 + i * 1.27).round();
    if (!out.contains(cm)) out.add(cm);
  }
  return out;
}();

String heightLabel(int cm) => '${height(cm)} ($cm cm)';

String? income(int? lpa) {
  if (lpa == null) return null;
  return lpa == 0 ? 'Not working' : '₹$lpa lakh a year';
}

final _inr = NumberFormat.decimalPattern('en_IN');
String inr(num n) => '₹${_inr.format(n)}';

final _date = DateFormat('d MMM y');
final _time = DateFormat('h:mm a');
String date(DateTime? d) => d == null ? '' : _date.format(d);
String time(DateTime d) => _time.format(d).toLowerCase();

/// "just now", "5 min ago", "yesterday", "12 Mar 2026"
String ago(DateTime? d) {
  if (d == null) return '';
  final diff = DateTime.now().difference(d);
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
  if (diff.inHours < 24) return '${diff.inHours} h ago';
  if (diff.inDays < 2) return 'yesterday';
  if (diff.inDays < 7) return '${diff.inDays} days ago';
  return date(d);
}

/// "Today" / "Yesterday" / "3 March" for chat day separators.
String dayLabel(DateTime d) {
  final now = DateTime.now();
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(d.year, d.month, d.day);
  final diff = today.difference(day).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Yesterday';
  return DateFormat(d.year == now.year ? 'd MMMM' : 'd MMMM y').format(d);
}

String plural(int n, String one, [String? many]) => '$n ${n == 1 ? one : (many ?? '${one}s')}';

/// +919876543210 → +91 98765 43210
String? phone(String? e164) {
  if (e164 == null || e164.isEmpty) return null;
  final d = e164.replaceFirst(RegExp(r'^\+91'), '');
  return d.length == 10 ? '+91 ${d.substring(0, 5)} ${d.substring(5)}' : e164;
}

/// Ends a sentence that came from the server, so the next one does not run into it.
String sentence(String? text) {
  final t = (text ?? '').trim();
  if (t.isEmpty || RegExp(r'[.!?।]$').hasMatch(t)) return t;
  return '$t.';
}

/// "34 · Divorced · Pune"
String summaryLine({int? age, String? maritalStatus, String? city}) =>
    [if (age != null) '$age', if (maritalStatus != null) marital[maritalStatus] ?? maritalStatus, ?city]
        .join(' · ');

String durationText(int days) {
  if (days % 365 == 0) return days == 365 ? '1 year' : '${days ~/ 365} years';
  if (days % 30 == 0) return days == 30 ? '1 month' : '${days ~/ 30} months';
  return '$days days';
}

/// "Unlimited", "Not included", or "15 a day".
String limitText(int value, [String unit = '']) {
  if (value == -1) return 'Unlimited';
  if (value == 0) return 'Not included';
  final n = _inr.format(value);
  return unit.isEmpty ? n : '$n $unit';
}

/// "2S10001", "2s-10001", "#10001" or "10001" → "10001"; null when it is not an ID.
String? profileNumber(String raw) {
  final m = RegExp(r'^\s*(?:2\s*s\s*-?\s*|#)?(\d{1,9})\s*$', caseSensitive: false).firstMatch(raw);
  return m?.group(1);
}

String greeting() {
  final h = DateTime.now().hour;
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
