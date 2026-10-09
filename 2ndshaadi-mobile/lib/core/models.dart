import 'json.dart';

/// Data shapes returned by the 2ndShaadi API (see frontend/src/api/types.ts).

class CompletionStep {
  final String key;
  final String label;
  final bool done;
  const CompletionStep(this.key, this.label, this.done);
  factory CompletionStep.fromJson(Json j) => CompletionStep(str(j['key']), str(j['label']), boolean(j['done']));
}

/// Plan features: limits (numbers, -1 = unlimited) and on/off flags.
class PlanFeatures {
  final Json raw;
  const PlanFeatures(this.raw);
  factory PlanFeatures.fromJson(Object? j) => PlanFeatures(asMap(j));

  int limit(String key) => integer(raw[key]);
  bool flag(String key) {
    final v = raw[key];
    if (v is bool) return v;
    if (v is num) return v != 0;
    return false;
  }

  bool get advancedFilters => flag('advancedFilters');
  bool get interestNote => flag('interestNote');
  bool get startChats => flag('startChats');
  bool get chatControls => flag('chatControls');
  bool get seeOnlineStatus => flag('seeOnlineStatus');
  bool get incognito => flag('incognito');
  bool get premiumBadge => flag('premiumBadge');
  int get interestsPerDay => limit('interestsPerDay');
  int get profileViewsPerDay => limit('profileViewsPerDay');
  int get contactViewsPerMonth => limit('contactViewsPerMonth');
}

class PrivacySettings {
  final bool sharePhoneWithFree, sharePhoneWithPaid, shareEmailWithFree, shareEmailWithPaid;
  final bool visibleToFree, visibleToPaid, incognito, acceptChatsFromFree, acceptChatsFromPaid;
  final String photoVisibility;
  const PrivacySettings({
    this.sharePhoneWithFree = false,
    this.sharePhoneWithPaid = false,
    this.shareEmailWithFree = false,
    this.shareEmailWithPaid = false,
    this.visibleToFree = true,
    this.visibleToPaid = true,
    this.incognito = false,
    this.acceptChatsFromFree = true,
    this.acceptChatsFromPaid = true,
    this.photoVisibility = 'ALL',
  });
  factory PrivacySettings.fromJson(Object? o) {
    final j = asMap(o);
    return PrivacySettings(
      sharePhoneWithFree: boolean(j['sharePhoneWithFree']),
      sharePhoneWithPaid: boolean(j['sharePhoneWithPaid']),
      shareEmailWithFree: boolean(j['shareEmailWithFree']),
      shareEmailWithPaid: boolean(j['shareEmailWithPaid']),
      visibleToFree: boolean(j['visibleToFree'], true),
      visibleToPaid: boolean(j['visibleToPaid'], true),
      incognito: boolean(j['incognito']),
      acceptChatsFromFree: boolean(j['acceptChatsFromFree'], true),
      acceptChatsFromPaid: boolean(j['acceptChatsFromPaid'], true),
      photoVisibility: str(j['photoVisibility'], 'ALL'),
    );
  }
}

class PlanBadgeInfo {
  final String name;
  final String tone; // silver | gold | platinum
  const PlanBadgeInfo(this.name, this.tone);
  static PlanBadgeInfo? fromJson(Object? o) {
    final j = asMap(o);
    final tone = str(j['tone']);
    if (j.isEmpty || !const ['silver', 'gold', 'platinum'].contains(tone)) return null;
    return PlanBadgeInfo(str(j['name']), tone);
  }
}

class Nominee {
  final String name, relation, contact;
  const Nominee(this.name, this.relation, this.contact);
}

/// The signed-in member.
class Me {
  final String id, profileId, role, plan, planName, journeyStatus, name, displayName, gender;
  final String? email, phone, photo, chatBanReason;
  final PlanBadgeInfo? planBadge;
  final bool isPaid, chatBanned, showOnlineStatus, isHidden, profileComplete;
  final DateTime? planExpiresAt, deletionScheduledFor;
  final PlanFeatures features;
  final PrivacySettings privacy;
  final Nominee? nominee;
  final int completionPercent;
  final List<CompletionStep> completionSteps;

  const Me({
    required this.id,
    required this.profileId,
    required this.role,
    required this.plan,
    required this.planName,
    required this.journeyStatus,
    required this.name,
    required this.displayName,
    required this.gender,
    required this.email,
    required this.phone,
    required this.photo,
    required this.chatBanReason,
    required this.planBadge,
    required this.isPaid,
    required this.chatBanned,
    required this.showOnlineStatus,
    required this.isHidden,
    required this.profileComplete,
    required this.planExpiresAt,
    required this.deletionScheduledFor,
    required this.features,
    required this.privacy,
    required this.nominee,
    required this.completionPercent,
    required this.completionSteps,
  });

  factory Me.fromJson(Json j) {
    final completion = asMap(j['completion']);
    final nominee = asMap(j['nominee']);
    return Me(
      id: str(j['id']),
      profileId: str(j['profileId']),
      role: str(j['role'], 'USER'),
      plan: str(j['plan'], 'FREE'),
      planName: str(j['planName'], 'Free'),
      journeyStatus: str(j['journeyStatus'], 'ACTIVE'),
      name: str(j['name']),
      displayName: str(j['displayName'], str(j['name'])),
      gender: str(j['gender'], 'MALE'),
      email: strN(j['email']),
      phone: strN(j['phone']),
      photo: strN(j['photo']),
      chatBanReason: strN(j['chatBanReason']),
      planBadge: PlanBadgeInfo.fromJson(j['planBadge']),
      isPaid: boolean(j['isPaid']),
      chatBanned: boolean(j['chatBanned']),
      showOnlineStatus: boolean(j['showOnlineStatus'], true),
      isHidden: boolean(j['isHidden']),
      profileComplete: boolean(j['profileComplete']),
      planExpiresAt: dateN(j['planExpiresAt']),
      deletionScheduledFor: dateN(asMap(j['deletion'])['scheduledFor']),
      features: PlanFeatures.fromJson(j['features']),
      privacy: PrivacySettings.fromJson(j['privacy']),
      nominee: nominee.isEmpty
          ? null
          : Nominee(str(nominee['name']), str(nominee['relation']), str(nominee['contact'])),
      completionPercent: integer(completion['percent']),
      completionSteps: asList(completion['steps'], CompletionStep.fromJson),
    );
  }

  String get firstName => displayName.split(' ').first;
}

/// A member in lists (search, shortlist, visitors, interests).
class MemberCard {
  final String userId, profileId, name, gender;
  final int? age, heightCm, matchScore;
  final String? maritalStatus, city, state, religion, motherTongue, profession, education, photo, photoLock;
  final int childrenCount, photoCount;
  final bool shortlisted, online, connected, premium, isNew;
  final PlanBadgeInfo? planBadge;
  final List<String> highlights;
  final DateTime? at; // shortlistedAt / viewedAt

  const MemberCard({
    required this.userId,
    required this.profileId,
    required this.name,
    required this.gender,
    this.age,
    this.heightCm,
    this.matchScore,
    this.maritalStatus,
    this.city,
    this.state,
    this.religion,
    this.motherTongue,
    this.profession,
    this.education,
    this.photo,
    this.photoLock,
    this.childrenCount = 0,
    this.photoCount = 0,
    this.shortlisted = false,
    this.online = false,
    this.connected = false,
    this.premium = false,
    this.isNew = false,
    this.planBadge,
    this.highlights = const [],
    this.at,
  });

  factory MemberCard.fromJson(Json j) => MemberCard(
        userId: str(j['userId']),
        profileId: str(j['profileId']),
        name: str(j['name'], 'Member'),
        gender: str(j['gender'], 'FEMALE'),
        age: intN(j['age']),
        heightCm: intN(j['heightCm']),
        matchScore: intN(j['matchScore']),
        maritalStatus: strN(j['maritalStatus']),
        city: strN(j['city']),
        state: strN(j['state']),
        religion: strN(j['religion']),
        motherTongue: strN(j['motherTongue']),
        profession: strN(j['profession']),
        education: strN(j['education']),
        photo: strN(j['photo']),
        photoLock: strN(j['photoLock']),
        childrenCount: integer(j['childrenCount']),
        photoCount: integer(j['photoCount']),
        shortlisted: boolean(j['shortlisted']),
        online: boolean(j['online']),
        connected: boolean(j['connected']),
        premium: boolean(j['premium']),
        isNew: boolean(j['isNew']),
        planBadge: PlanBadgeInfo.fromJson(j['planBadge']),
        highlights: strList(j['highlights']),
        at: dateN(j['shortlistedAt'] ?? j['viewedAt'] ?? j['hiddenAt']),
      );

  MemberCard copyWith({bool? shortlisted}) => MemberCard(
        userId: userId,
        profileId: profileId,
        name: name,
        gender: gender,
        age: age,
        heightCm: heightCm,
        matchScore: matchScore,
        maritalStatus: maritalStatus,
        city: city,
        state: state,
        religion: religion,
        motherTongue: motherTongue,
        profession: profession,
        education: education,
        photo: photo,
        photoLock: photoLock,
        childrenCount: childrenCount,
        photoCount: photoCount,
        shortlisted: shortlisted ?? this.shortlisted,
        online: online,
        connected: connected,
        premium: premium,
        isNew: isNew,
        planBadge: planBadge,
        highlights: highlights,
        at: at,
      );

  String get firstName => name.split(' ').first;
}

class Criterion {
  final String label;
  final bool met;
  const Criterion(this.label, this.met);
  factory Criterion.fromJson(Json j) => Criterion(str(j['label']), boolean(j['met']));
}

class InterestRef {
  final String id, status, direction;
  const InterestRef(this.id, this.status, this.direction);
  static InterestRef? fromJson(Object? o) {
    final j = asMap(o);
    if (j.isEmpty) return null;
    return InterestRef(str(j['id']), str(j['status']), str(j['direction']));
  }
}

class ContactState {
  final String state; // OFF NOT_SHARED UPGRADE LIMIT AVAILABLE REVEALED
  final bool sharesPhone, sharesEmail, connected;
  final int? remaining;
  final String? phone, email;
  const ContactState({
    required this.state,
    this.sharesPhone = false,
    this.sharesEmail = false,
    this.connected = false,
    this.remaining,
    this.phone,
    this.email,
  });
  factory ContactState.fromJson(Object? o) {
    final j = asMap(o);
    return ContactState(
      state: str(j['state'], 'OFF'),
      sharesPhone: boolean(j['sharesPhone']),
      sharesEmail: boolean(j['sharesEmail']),
      connected: boolean(j['connected']),
      remaining: intN(j['remaining']),
      phone: strN(j['phone']),
      email: strN(j['email']),
    );
  }
}

class FullProfile {
  final MemberCard card;
  final List<String> photos;
  final int photosLocked;
  final bool detailsLocked, verifiedMobile, ignored;
  final ContactState contact;
  final String? community, aboutMe, lookingFor, diet, smoking, drinking;
  final int? incomeLpa;
  final String country;
  final bool childrenLiveWithMe;
  final bool? wantsMoreChildren;
  final DateTime? memberSince;
  final int matchScoreValue;
  final List<String> matchHighlights;
  final bool breakdownLocked, dealBreaker;
  final List<Criterion> theyFitYou, youFitThem;
  final InterestRef? interest;
  final bool presenceOnline;
  final DateTime? lastSeenAt;

  const FullProfile({
    required this.card,
    required this.photos,
    required this.photosLocked,
    required this.detailsLocked,
    required this.verifiedMobile,
    required this.ignored,
    required this.contact,
    required this.community,
    required this.aboutMe,
    required this.lookingFor,
    required this.diet,
    required this.smoking,
    required this.drinking,
    required this.incomeLpa,
    required this.country,
    required this.childrenLiveWithMe,
    required this.wantsMoreChildren,
    required this.memberSince,
    required this.matchScoreValue,
    required this.matchHighlights,
    required this.breakdownLocked,
    required this.dealBreaker,
    required this.theyFitYou,
    required this.youFitThem,
    required this.interest,
    required this.presenceOnline,
    required this.lastSeenAt,
  });

  factory FullProfile.fromJson(Json j) {
    final match = asMap(j['match']);
    final presence = asMap(j['presence']);
    return FullProfile(
      card: MemberCard.fromJson(j),
      photos: strList(j['photos']),
      photosLocked: integer(j['photosLocked']),
      detailsLocked: boolean(j['detailsLocked']),
      verifiedMobile: boolean(j['verifiedMobile']),
      ignored: boolean(j['ignored']),
      contact: ContactState.fromJson(j['contact']),
      community: strN(j['community']),
      aboutMe: strN(j['aboutMe']),
      lookingFor: strN(j['lookingFor']),
      diet: strN(j['diet']),
      smoking: strN(j['smoking']),
      drinking: strN(j['drinking']),
      incomeLpa: intN(j['incomeLpa']),
      country: str(j['country'], 'India'),
      childrenLiveWithMe: boolean(j['childrenLiveWithMe']),
      wantsMoreChildren: boolN(j['wantsMoreChildren']),
      memberSince: dateN(j['memberSince']),
      matchScoreValue: integer(match['score']),
      matchHighlights: strList(match['highlights']),
      breakdownLocked: boolean(match['breakdownLocked']),
      dealBreaker: boolean(match['dealBreaker']),
      theyFitYou: asList(match['theyFitYou'], Criterion.fromJson),
      youFitThem: asList(match['youFitThem'], Criterion.fromJson),
      interest: InterestRef.fromJson(j['interest']),
      presenceOnline: boolean(presence['online']),
      lastSeenAt: dateN(presence['lastSeenAt']),
    );
  }

  FullProfile withContact(ContactState c) => FullProfile(
        card: card,
        photos: photos,
        photosLocked: photosLocked,
        detailsLocked: detailsLocked,
        verifiedMobile: verifiedMobile,
        ignored: ignored,
        contact: c,
        community: community,
        aboutMe: aboutMe,
        lookingFor: lookingFor,
        diet: diet,
        smoking: smoking,
        drinking: drinking,
        incomeLpa: incomeLpa,
        country: country,
        childrenLiveWithMe: childrenLiveWithMe,
        wantsMoreChildren: wantsMoreChildren,
        memberSince: memberSince,
        matchScoreValue: matchScoreValue,
        matchHighlights: matchHighlights,
        breakdownLocked: breakdownLocked,
        dealBreaker: dealBreaker,
        theyFitYou: theyFitYou,
        youFitThem: youFitThem,
        interest: interest,
        presenceOnline: presenceOnline,
        lastSeenAt: lastSeenAt,
      );
}

/// The member's own editable profile.
class MyProfile {
  final Json raw;
  final List<String> photos;
  final DateTime? nameChangedAt, dobChangedAt, religionChangedAt;
  final bool isComplete;
  const MyProfile(this.raw, this.photos, this.nameChangedAt, this.dobChangedAt, this.religionChangedAt, this.isComplete);
  factory MyProfile.fromJson(Json j) => MyProfile(
        j,
        strList(j['photos']),
        dateN(j['nameChangedAt']),
        dateN(j['dobChangedAt']),
        dateN(j['religionChangedAt']),
        boolean(j['isComplete']),
      );
  String get id => str(raw['id']);
}

class Usage {
  final bool isPaid;
  final PlanFeatures features;
  final int? remainingInterests, remainingProfileViews, remainingContactViews;
  final Json raw;
  const Usage(this.raw, this.isPaid, this.features, this.remainingInterests, this.remainingProfileViews,
      this.remainingContactViews);
  factory Usage.fromJson(Json j) {
    final r = asMap(j['remaining']);
    return Usage(j, boolean(j['isPaid']), PlanFeatures.fromJson(j['features']), intN(r['interests']),
        intN(r['profileViews']), intN(r['contactViews']));
  }
}

class InterestItem {
  final String id, status, direction;
  final int? matchScore;
  final String? message;
  final DateTime? createdAt, respondedAt;
  final MemberCard profile;
  const InterestItem(this.id, this.status, this.direction, this.matchScore, this.message, this.createdAt,
      this.respondedAt, this.profile);
  factory InterestItem.fromJson(Json j) => InterestItem(
        str(j['id']),
        str(j['status']),
        str(j['direction']),
        intN(j['matchScore']),
        strN(j['message']),
        dateN(j['createdAt']),
        dateN(j['respondedAt']),
        MemberCard.fromJson(asMap(j['profile'])),
      );
}

class Conversation {
  final String peerId, name;
  final String? photo, lastBody;
  final bool online, lastFromMe;
  final DateTime? lastAt, connectedAt;
  final int unread;
  const Conversation(this.peerId, this.name, this.photo, this.online, this.lastBody, this.lastFromMe, this.lastAt,
      this.unread, this.connectedAt);
  factory Conversation.fromJson(Json j) {
    final last = asMap(j['lastMessage']);
    return Conversation(
      str(j['peerId']),
      str(j['name'], 'Member'),
      strN(j['photo']),
      boolean(j['online']),
      last.isEmpty ? null : str(last['body']),
      boolean(last['fromMe']),
      dateN(last['createdAt']),
      integer(j['unread']),
      dateN(j['connectedAt']),
    );
  }
}

class ChatMessage {
  final String id, senderId, receiverId, body;
  final DateTime createdAt;
  final DateTime? readAt;
  const ChatMessage(this.id, this.senderId, this.receiverId, this.body, this.createdAt, this.readAt);
  factory ChatMessage.fromJson(Json j) => ChatMessage(
        str(j['id']),
        str(j['senderId']),
        str(j['receiverId']),
        str(j['body']),
        dateN(j['createdAt']) ?? DateTime.now(),
        dateN(j['readAt']),
      );
  ChatMessage read(DateTime at) => ChatMessage(id, senderId, receiverId, body, createdAt, at);
}

class AppNotification {
  final String id, type, title, body;
  final String? link;
  final DateTime? readAt, createdAt;
  const AppNotification(this.id, this.type, this.title, this.body, this.link, this.readAt, this.createdAt);
  factory AppNotification.fromJson(Json j) => AppNotification(
        str(j['id']),
        str(j['type'], 'SYSTEM'),
        str(j['title']),
        str(j['body']),
        strN(j['link']),
        dateN(j['readAt']),
        dateN(j['createdAt']),
      );
}

class PlanOffer {
  final String id, code, name, tagline, badgeTone;
  final int priceInr, durationDays;
  final int? mrpInr;
  final bool isFree, isPopular;
  final PlanFeatures features;
  const PlanOffer(this.id, this.code, this.name, this.tagline, this.badgeTone, this.priceInr, this.durationDays,
      this.mrpInr, this.isFree, this.isPopular, this.features);
  factory PlanOffer.fromJson(Json j) => PlanOffer(
        str(j['id']),
        str(j['code']),
        str(j['name']),
        str(j['tagline']),
        str(j['badgeTone'], 'none'),
        integer(j['priceInr']),
        integer(j['durationDays'], 30),
        intN(j['mrpInr']),
        boolean(j['isFree']),
        boolean(j['isPopular']),
        PlanFeatures.fromJson(j['features']),
      );
}

class FeatureDef {
  final String key, type, label, hint, group, unit;
  const FeatureDef(this.key, this.type, this.label, this.hint, this.group, this.unit);
}

class Catalogue {
  final List<PlanOffer> plans;
  final Map<String, FeatureDef> features;
  const Catalogue(this.plans, this.features);
  factory Catalogue.fromJson(Json j) {
    final f = asMap(j['features']);
    return Catalogue(
      asList(j['plans'], PlanOffer.fromJson),
      {
        for (final e in f.entries)
          e.key: FeatureDef(e.key, str(asMap(e.value)['type'], 'flag'), str(asMap(e.value)['label'], e.key),
              str(asMap(e.value)['hint']), str(asMap(e.value)['group']), str(asMap(e.value)['unit'])),
      },
    );
  }
}

class Announcement {
  final String id, title, body, tone;
  final String? linkUrl, linkLabel;
  final bool isDismissible;
  final int version;
  const Announcement(
      this.id, this.title, this.body, this.tone, this.linkUrl, this.linkLabel, this.isDismissible, this.version);
  factory Announcement.fromJson(Json j) => Announcement(
        str(j['id']),
        str(j['title']),
        str(j['body']),
        str(j['tone'], 'INFO'),
        strN(j['linkUrl']),
        strN(j['linkLabel']),
        boolean(j['isDismissible'], true),
        integer(j['version'], 1),
      );
}

class FooterPage {
  final String slug, title, group;
  const FooterPage(this.slug, this.title, this.group);
}

/// Site-wide settings (maintenance, modules, rules) set by admins.
class SiteConfig {
  final Json settings;
  final List<FooterPage> pages;
  final List<Announcement> announcements;
  const SiteConfig(this.settings, this.pages, this.announcements);
  factory SiteConfig.fromJson(Json j) => SiteConfig(
        asMap(j['settings']),
        asList(j['footer'], (p) => FooterPage(str(p['slug']), str(p['title']), str(p['group']))),
        asList(j['announcements'], Announcement.fromJson),
      );
  static const empty = SiteConfig({}, [], []);

  Json section(String name) => asMap(settings[name]);
  bool get maintenance => boolean(section('maintenance')['enabled']);
  String get maintenanceTitle => str(section('maintenance')['title'], 'We will be right back');
  String get maintenanceMessage =>
      str(section('maintenance')['message'], 'We are making 2ndShaadi better. Please check back in a little while.');
  bool module(String key) => boolean(section('modules')[key], true);
  bool get registrationOpen => boolean(section('registration')['open'], true);
  int get maxPhotos => integer(section('photoRules')['maxPhotos'], 3);
  int get chatMaxLength => integer(section('chatRules')['maxLength'], 2000);
  int get aboutMinLength => integer(section('profileRules')['aboutMinLength'], 50);
  String get siteName => str(section('general')['siteName'], '2ndShaadi');
  String get supportEmail => str(section('general')['supportEmail']);
  String get supportPhone => str(section('general')['supportPhone']);
}

class SavedSearch {
  final String id, name;
  final Map<String, String> filters;
  final bool notify;
  final int newCount;
  final List<String> locked;
  const SavedSearch(this.id, this.name, this.filters, this.notify, this.newCount, this.locked);
  factory SavedSearch.fromJson(Json j) => SavedSearch(
        str(j['id']),
        str(j['name']),
        asMap(j['filters']).map((k, v) => MapEntry(k, '$v')),
        boolean(j['notify']),
        integer(j['newCount']),
        strList(j['locked']),
      );
}

class Preferences {
  final Json raw;
  const Preferences(this.raw);
}
