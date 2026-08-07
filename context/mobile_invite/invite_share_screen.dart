import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

import 'invite_api.dart';

/// Admin/owner: show invite link + QR. Uses GET so code is not rotated on open.
class InviteShareScreen extends StatefulWidget {
  const InviteShareScreen({
    super.key,
    required this.api,
    required this.familySpaceId,
  });

  final InviteApi api;
  final String familySpaceId;

  @override
  State<InviteShareScreen> createState() => _InviteShareScreenState();
}

class _InviteShareScreenState extends State<InviteShareScreen> {
  InvitePayload? _invite;
  String? _error;
  bool _loading = true;
  bool _rotating = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final invite = await widget.api.getInvite(widget.familySpaceId);
      if (!mounted) return;
      setState(() {
        _invite = invite;
        _loading = false;
      });
    } catch (e) {
      // No code yet — generate once.
      try {
        final invite = await widget.api.rotateInvite(widget.familySpaceId);
        if (!mounted) return;
        setState(() {
          _invite = invite;
          _loading = false;
        });
      } catch (e2) {
        if (!mounted) return;
        setState(() {
          _error = e2.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _rotate() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Generate new code?'),
        content: const Text(
          'Old invite links and QR codes will stop working.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Generate')),
        ],
      ),
    );
    if (ok != true) return;
    setState(() => _rotating = true);
    try {
      final invite = await widget.api.rotateInvite(widget.familySpaceId);
      if (!mounted) return;
      setState(() {
        _invite = invite;
        _rotating = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _rotating = false);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final invite = _invite;
    return Scaffold(
      appBar: AppBar(title: const Text('Invite members')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(child: Text(_error!))
              : ListView(
                  padding: const EdgeInsets.all(24),
                  children: [
                    Text(
                      invite?.familyName ?? 'Family invite',
                      style: Theme.of(context).textTheme.headlineSmall,
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'Share this link or QR. Recipients open it, sign in, and join your family space.',
                    ),
                    const SizedBox(height: 24),
                    Center(
                      child: QrImageView(
                        data: invite!.inviteUrl,
                        size: 220,
                        backgroundColor: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 16),
                    SelectableText(
                      invite.inviteCode,
                      style: Theme.of(context).textTheme.titleLarge,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 8),
                    SelectableText(
                      invite.inviteUrl,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 24),
                    FilledButton.icon(
                      onPressed: () => Share.share(
                        'Join our family on Kincore:\n${invite.inviteUrl}',
                        subject: 'Kincore family invite',
                      ),
                      icon: const Icon(Icons.ios_share),
                      label: const Text('Share link'),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton.icon(
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: invite.inviteUrl));
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Link copied')),
                        );
                      },
                      icon: const Icon(Icons.copy),
                      label: const Text('Copy link'),
                    ),
                    const SizedBox(height: 8),
                    TextButton(
                      onPressed: _rotating ? null : _rotate,
                      child: _rotating
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Generate new code'),
                    ),
                  ],
                ),
    );
  }
}
