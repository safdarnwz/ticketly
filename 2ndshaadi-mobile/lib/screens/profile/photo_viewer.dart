import 'package:flutter/material.dart';

import '../../widgets/photo.dart';

/// Full-screen photos: swipe between them, pinch to zoom, swipe down or back to close.
class PhotoViewer extends StatefulWidget {
  const PhotoViewer({super.key, required this.photos, required this.name, this.initial = 0});
  final List<String> photos;
  final String name;
  final int initial;

  static Future<void> open(BuildContext context, List<String> photos, String name, int initial) {
    return Navigator.of(context, rootNavigator: true).push(PageRouteBuilder<void>(
      opaque: false,
      barrierColor: Colors.black,
      pageBuilder: (_, _, _) => PhotoViewer(photos: photos, name: name, initial: initial),
      transitionsBuilder: (_, a, _, child) => FadeTransition(opacity: a, child: child),
    ));
  }

  @override
  State<PhotoViewer> createState() => _PhotoViewerState();
}

class _PhotoViewerState extends State<PhotoViewer> {
  late final _page = PageController(initialPage: widget.initial);
  late int index = widget.initial;

  @override
  void dispose() {
    _page.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        children: [
          PageView.builder(
            controller: _page,
            itemCount: widget.photos.length,
            onPageChanged: (i) => setState(() => index = i),
            itemBuilder: (c, i) => InteractiveViewer(
              minScale: 1,
              maxScale: 4,
              child: Center(
                child: Photo(
                  url: widget.photos[i],
                  name: widget.name,
                  radius: BorderRadius.zero,
                  fit: BoxFit.contain,
                ),
              ),
            ),
          ),
          SafeArea(
            child: Row(
              children: [
                IconButton(
                  tooltip: 'Close',
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded, color: Colors.white),
                ),
                const Spacer(),
                if (widget.photos.length > 1)
                  Padding(
                    padding: const EdgeInsets.only(right: 16),
                    child: Text('${index + 1} / ${widget.photos.length}', style: const TextStyle(color: Colors.white)),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
