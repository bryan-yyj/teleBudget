import 'package:flutter_test/flutter_test.dart';
import 'package:telebudget/main.dart';

void main() {
  testWidgets('TeleBudget app smoke test', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const TeleBudgetApp());

    // Verify that the app title is displayed
    expect(find.text('TeleBudget'), findsOneWidget);

    // Verify that the total spent section exists
    expect(find.text('Total Spent'), findsOneWidget);
  });
}