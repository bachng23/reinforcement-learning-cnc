const ADMIN_ROLE = 'ADMIN';
const RESEARCH_MUTATION_ROLES = ['ADMIN', 'ENGINEER', 'OPERATOR'];

const isResearchAdmin = (user) => user?.role === ADMIN_ROLE;

const experimentAccessWhere = (user, id) => ({
  id,
  ...(isResearchAdmin(user) ? {} : { createdById: user.id }),
});

const episodeAccessWhere = (user, id) => ({
  id,
  ...(isResearchAdmin(user) ? {} : {
    experiment: { createdById: user.id },
  }),
});

module.exports = {
  RESEARCH_MUTATION_ROLES,
  episodeAccessWhere,
  experimentAccessWhere,
  isResearchAdmin,
};
