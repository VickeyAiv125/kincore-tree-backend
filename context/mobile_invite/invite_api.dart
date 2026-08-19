import 'dart:convert';

import 'package:http/http.dart' as http;

/// Kincore family invite API helpers (UAT).
class InviteApi {
  InviteApi({
    required this.baseUrl,
    required this.getAccessToken,
  });

  /// e.g. https://uat-api.kincore.com
  final String baseUrl;
  final Future<String?> Function() getAccessToken;

  Uri _u(String path) => Uri.parse('$baseUrl$path');

  Future<Map<String, String>> _headers() async {
    final token = await getAccessToken();
    if (token == null || token.isEmpty) {
      throw StateError('Not authenticated');
    }
    return {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }

  /// Current invite — does NOT rotate the code.
  Future<InvitePayload> getInvite(String familySpaceId) async {
    final res = await http.get(
      _u('/api/families/$familySpaceId/invite'),
      headers: await _headers(),
    );
    final body = jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw InviteApiException(res.statusCode, body['error']?.toString() ?? res.body);
    }
    return InvitePayload.fromJson(Map<String, dynamic>.from(body as Map));
  }

  /// Regenerates code — old links/QR stop working.
  Future<InvitePayload> rotateInvite(String familySpaceId) async {
    final res = await http.post(
      _u('/api/families/$familySpaceId/invite'),
      headers: await _headers(),
      body: '{}',
    );
    final body = jsonDecode(res.body);
    if (res.statusCode >= 400) {
      throw InviteApiException(res.statusCode, body['error']?.toString() ?? res.body);
    }
    return InvitePayload.fromJson(Map<String, dynamic>.from(body as Map));
  }

  /// [link] may be full URL, deep link, or raw code.
  Future<JoinResult> joinViaLink(String link) async {
    final res = await http.post(
      _u('/api/families/join-link'),
      headers: await _headers(),
      body: jsonEncode({'link': link.trim()}),
    );
    final body = jsonDecode(res.body);
    if (res.statusCode == 409) {
      return JoinResult(
        alreadyMember: true,
        spaceId: body['space_id']?.toString(),
        message: body['error']?.toString() ?? 'Already a member',
      );
    }
    if (res.statusCode >= 400) {
      throw InviteApiException(res.statusCode, body['error']?.toString() ?? res.body);
    }
    return JoinResult(
      alreadyMember: false,
      spaceId: body['space_id']?.toString(),
      message: body['message']?.toString() ?? 'Joined',
    );
  }

  /// Extract code from URL / deep link / raw.
  static String? extractCode(String raw) {
    final t = raw.trim();
    if (t.isEmpty) return null;
    try {
      final uri = Uri.parse(t);
      if (uri.hasScheme && (uri.scheme == 'http' || uri.scheme == 'https' || uri.scheme == 'kincore')) {
        final q = uri.queryParameters['code'];
        if (q != null && q.isNotEmpty) return q.toUpperCase();
        if (uri.pathSegments.isNotEmpty) {
          return uri.pathSegments.last.toUpperCase();
        }
      }
    } catch (_) {}
    return t.toUpperCase();
  }
}

class InvitePayload {
  InvitePayload({
    required this.inviteCode,
    required this.inviteUrl,
    required this.deepLink,
    this.familySpaceId,
    this.familyName,
  });

  final String inviteCode;
  final String inviteUrl;
  final String deepLink;
  final String? familySpaceId;
  final String? familyName;

  factory InvitePayload.fromJson(Map<String, dynamic> j) => InvitePayload(
        inviteCode: (j['invite_code'] ?? '').toString(),
        inviteUrl: (j['invite_url'] ?? '').toString(),
        deepLink: (j['deep_link'] ?? '').toString(),
        familySpaceId: j['family_space_id']?.toString(),
        familyName: j['family_name']?.toString(),
      );
}

class JoinResult {
  JoinResult({
    required this.alreadyMember,
    required this.message,
    this.spaceId,
  });

  final bool alreadyMember;
  final String message;
  final String? spaceId;
}

class InviteApiException implements Exception {
  InviteApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;

  @override
  String toString() => 'InviteApiException($statusCode): $message';
}
