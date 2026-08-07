import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/widgets.dart';

import 'invite_api.dart';

/// Wire once at app start. Persists pending code across login.
class InviteDeepLinkHandler {
  InviteDeepLinkHandler({
    required this.isLoggedIn,
    required this.openJoinScreen,
    required this.promptLoginThenJoin,
  });

  final bool Function() isLoggedIn;
  final void Function(String linkOrCode) openJoinScreen;
  final void Function(String pendingLinkOrCode) promptLoginThenJoin;

  final AppLinks _appLinks = AppLinks();
  StreamSubscription<Uri>? _sub;
  static const _pendingKey = 'kincore_pending_invite';

  /// Call from main()/root after first frame.
  Future<void> start() async {
    try {
      final initial = await _appLinks.getInitialLink();
      if (initial != null) _handleUri(initial);
    } catch (_) {}

    _sub = _appLinks.uriLinkStream.listen(_handleUri, onError: (_) {});
  }

  void dispose() {
    _sub?.cancel();
  }

  void _handleUri(Uri uri) {
    final link = uri.toString();
    final code = InviteApi.extractCode(link);
    if (code == null || code.isEmpty) return;

    if (isLoggedIn()) {
      openJoinScreen(link);
    } else {
      promptLoginThenJoin(link);
    }
  }

  /// After successful login, call with the stashed link from your session/prefs.
  static String? readPendingFromPrefs(Map<String, String?> prefs) => prefs[_pendingKey];

  static Map<String, String> pendingPrefsEntry(String link) => {_pendingKey: link};
}

/// Example GoRouter redirect helper — adapt to your router.
String? inviteLoginRedirect({
  required bool loggedIn,
  required String? pendingInvite,
  required String loginPath,
  required String joinPath,
}) {
  if (pendingInvite == null || pendingInvite.isEmpty) return null;
  if (!loggedIn) return loginPath;
  return '$joinPath?link=${Uri.encodeComponent(pendingInvite)}';
}
