// SQL identifiers come only from this fixed configuration, never from request input.
export const reviewTargets = [
  {
    kind: 'teachers',
    reviews: 'teacher_reviews',
    foreignKey: 'teacher_id',
    votes: 'teacher_review_votes',
    replies: 'teacher_review_replies',
  },
  {
    kind: 'courses',
    reviews: 'course_reviews',
    foreignKey: 'course_id',
    votes: 'course_review_votes',
    replies: 'course_review_replies',
  },
] as const;
