import 'package:flutter/material.dart';

import 'invite_api.dart';

/// Paste invite URL/code, or land here from a deep link with [initialLinkOrCode].
class JoinLinkScreen extends StatefulWidget {
  const JoinLinkScreen({
    super.key,
    required this.api,
    this.initialLinkOrCode,
    required this.onJoined,
  });

  final InviteApi api;
  final String? initialLinkOrCode;

  /// Navigate to home/tree with the joined space id.
  final void Function(String spaceId) onJoined;

  @override
  State<JoinLinkScreen> createState() => _JoinLinkScreenState();
}

class _JoinLinkScreenState extends State<JoinLinkScreen> {
  late final TextEditingController _controller;
  bool _busy = false;
  String? _message;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialLinkOrCode ?? '');
    if (widget.initialLinkOrCode != null && widget.initialLinkOrCode!.trim().isNotEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _submit());
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final raw = _controller.text.trim();
    if (raw.isEmpty) {
      setState(() => _message = 'Paste an invite link or code');
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final result = await widget.api.joinViaLink(raw);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _message = result.message;
      });
      final spaceId = result.spaceId;
      if (spaceId != null && spaceId.isNotEmpty) {
        widget.onJoined(spaceId);
      } else if (result.alreadyMember) {
        // Backend may not return space_id on 409 — caller can refresh memberships.
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(result.message)),
        );
      }
    } on InviteApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _message = e.message;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _message = e.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Join via link')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Paste the invite link from your family, or type the invite code.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _controller,
              decoration: const InputDecoration(
                labelText: 'Invite link or code',
                hintText: 'https://uat.kincore.com/join/FAM-… or FAM-…',
                border: OutlineInputBorder(),
              ),
              textInputAction: TextInputAction.done,
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Join family'),
            ),
            if (_message != null) ...[
              const SizedBox(height: 12),
              Text(_message!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ],
        ),
      ),
    );
  }
}
