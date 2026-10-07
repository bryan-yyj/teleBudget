ALTER TABLE transactions ADD COLUMN meal_type TEXT
  CHECK (meal_type IS NULL OR meal_type IN ('Breakfast','Lunch','Dinner','Snacks & Drinks','Other food'));
-- Existing food entries remain unclassified; do not infer a meal from upload time.
