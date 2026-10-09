import 'package:flutter_test/flutter_test.dart';
import 'package:secondshaadi/app/links.dart';
import 'package:secondshaadi/core/format.dart';
import 'package:secondshaadi/core/json.dart';
import 'package:secondshaadi/core/models.dart';
import 'package:secondshaadi/core/permissions.dart';
import 'package:secondshaadi/screens/discover/filters.dart';

void main() {
  group('links from the server open the right screen', () {
    test('web paths map to app routes', () {
      expect(appRouteFor('/messages/abc'), '/chat/abc');
      expect(appRouteFor('/messages'), '/chats');
      expect(appRouteFor('/profile/xyz'), '/profile/xyz');
      expect(appRouteFor('/interests?tab=connected'), '/interests?tab=connected');
      expect(appRouteFor('/settings#devices'), '/settings');
      expect(appRouteFor('/notifications'), '/alerts');
      expect(appRouteFor('/me'), '/edit-profile');
      expect(appRouteFor('/discover?saved=1'), '/discover?saved=1');
      expect(appRouteFor('/terms'), '/page/terms');
      expect(appRouteFor('https://example.com'), isNull);
    });
  });

  group('broken or missing data never throws', () {
    test('models accept nulls and wrong types', () {
      final me = Me.fromJson({'id': 1, 'features': 'x', 'privacy': null, 'completion': {'steps': 'bad'}});
      expect(me.id, '1');
      expect(me.completionSteps, isEmpty);
      expect(me.features.startChats, isFalse);
      final p = FullProfile.fromJson({'match': null, 'contact': 5, 'photos': null});
      expect(p.photos, isEmpty);
      expect(p.contact.state, 'OFF');
      expect(asList([1, null, {'userId': 'a'}], MemberCard.fromJson).length, 1);
      expect(integer('12.6'), 13);
      expect(dateN('not a date'), isNull);
    });
  });

  group('formatting', () {
    test('height, phone, ids', () {
      expect(height(168), '5′ 6″');
      expect(phone('+919876543210'), '+91 98765 43210');
      expect(profileNumber('2S-10001'), '10001');
      expect(profileNumber('#42'), '42');
      expect(profileNumber('abc'), isNull);
      expect(durationText(365), '1 year');
      expect(limitText(-1), 'Unlimited');
      expect(matchState('National Capital Territory of Delhi'), 'Delhi');
      expect(matchState('Orissa'), 'Odisha');
    });
  });

  group('search filters', () {
    test('clean keeps numbers in range and drops blanks', () {
      expect(cleanFilters({'ageMin': '10', 'ageMax': '200', 'city': ' ', 'religions': 'Hindu'}),
          {'ageMin': '18', 'ageMax': '80', 'religions': 'Hindu'});
    });
    test('chip labels', () {
      expect(groupLabel('age', {'ageMin': '30', 'ageMax': '40'}), '30–40 yrs');
      expect(groupLabel('maritalStatuses', {'maritalStatuses': 'DIVORCED,WIDOWED,SEPARATED'}), 'Divorced, Widowed +1');
      expect(activeGroups({'ageMin': '30', 'withPhoto': 'true'}), ['age', 'withPhoto']);
    });
  });
}
