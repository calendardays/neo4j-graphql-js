const {
  safeLabel,
  safeVar,
  getFilterParams,
  lowFirstLetter,
  isAddMutation,
  isCreateMutation,
  isUpdateMutation,
  isRemoveMutation,
  isDeleteMutation,
  computeOrderBy,
  innerFilterParams,
  paramsToString,
  filterNullParams,
  getOuterSkipLimit,
  getQueryCypherDirective,
  getMutationArguments,
  possiblySetFirstId,
  buildCypherParameters,
  getQueryArguments,
  initializeMutationParams,
  getMutationCypherDirective,
  splitSelectionParameters,
  getTemporalArguments,
  temporalPredicateClauses,
  isTemporalType,
  isGraphqlScalarType
} = require('./utils');
const { getNamedType } = require('graphql');
const { buildCypherSelection } = require('./selections');
const _ = require('lodash');

// Query API root operation branch
var translateQuery = ({
  resolveInfo,
  context,
  selections,
  variableName,
  typeName,
  schemaType,
  first,
  offset,
  _id,
  orderBy,
  otherParams
}) => {
  const [nullParams, nonNullParams] = filterNullParams({
    offset,
    first,
    otherParams
  });
  const filterParams = getFilterParams(nonNullParams);
  const queryArgs = getQueryArguments(resolveInfo);
  const temporalArgs = getTemporalArguments(queryArgs);
  const queryTypeCypherDirective = getQueryCypherDirective(resolveInfo);
  const cypherParams = getCypherParams(context);
  const queryParams = paramsToString(
    innerFilterParams(
      filterParams,
      temporalArgs,
      null,
      queryTypeCypherDirective ? true : false
    ),
    cypherParams
  );
  const safeVariableName = safeVar(variableName);
  const temporalClauses = temporalPredicateClauses(
    filterParams,
    safeVariableName,
    temporalArgs
  );
  const outerSkipLimit = getOuterSkipLimit(first);
  const orderByValue = computeOrderBy(resolveInfo, selections);

  if (queryTypeCypherDirective) {
    return customQuery({
      resolveInfo,
      cypherParams,
      schemaType,
      argString: queryParams,
      selections,
      variableName,
      typeName,
      orderByValue,
      outerSkipLimit,
      queryTypeCypherDirective,
      nonNullParams
    });
  } else {
    return nodeQuery({
      resolveInfo,
      cypherParams,
      schemaType,
      argString: queryParams,
      selections,
      variableName,
      typeName,
      temporalClauses,
      orderByValue,
      outerSkipLimit,
      nullParams,
      nonNullParams,
      filterParams,
      temporalArgs,
      _id
    });
  }
};

const getCypherParams = context => {
  return context &&
    context.cypherParams &&
    context.cypherParams instanceof Object &&
    Object.keys(context.cypherParams).length > 0
    ? context.cypherParams
    : undefined;
};

// Custom read operation
const customQuery = ({
  resolveInfo,
  cypherParams,
  schemaType,
  argString,
  selections,
  variableName,
  typeName,
  orderByValue,
  outerSkipLimit,
  queryTypeCypherDirective,
  nonNullParams
}) => {
  const safeVariableName = safeVar(variableName);
  const [subQuery, subParams] = buildCypherSelection({
    initial: '',
    cypherParams,
    selections,
    variableName,
    schemaType,
    resolveInfo,
    paramIndex: 1
  });
  const params = { ...nonNullParams, ...subParams };
  if (cypherParams) {
    params['cypherParams'] = cypherParams;
  }
  // QueryType with a @cypher directive
  const cypherQueryArg = queryTypeCypherDirective.arguments.find(x => {
    return x.name.value === 'statement';
  });
  const isScalarType = isGraphqlScalarType(schemaType);
  const temporalType = isTemporalType(schemaType.name);
  const query = `WITH apoc.cypher.runFirstColumn("${
    cypherQueryArg.value.value
  }", ${argString ||
    'null'}, True) AS x UNWIND x AS ${safeVariableName} RETURN ${safeVariableName} ${
    // Don't add subQuery for scalar type payloads
    // FIXME: fix subselection translation for temporal type payload
    !temporalType && !isScalarType
      ? `{${subQuery}} AS ${safeVariableName}${orderByValue}`
      : ''
  } ${outerSkipLimit}`;
  return [query, params];
};

// Generated API
const nodeQuery = ({
  resolveInfo,
  cypherParams,
  schemaType,
  selections,
  variableName,
  typeName,
  temporalClauses,
  orderByValue,
  outerSkipLimit,
  nullParams,
  nonNullParams,
  filterParams,
  temporalArgs,
  _id
}) => {
  const safeVariableName = safeVar(variableName);
  const safeLabelName = safeLabel(typeName);
  const [subQuery, subParams] = buildCypherSelection({
    initial: '',
    cypherParams,
    selections,
    variableName,
    schemaType,
    resolveInfo,
    paramIndex: 1
  });
  const params = { ...nonNullParams, ...subParams };
  if (cypherParams) {
    params['cypherParams'] = cypherParams;
  }
  const arrayParams = _.pickBy(filterParams, Array.isArray);
  const args = innerFilterParams(filterParams, temporalArgs);

  const argString = paramsToString(
    _.filter(args, arg => !Array.isArray(arg.value))
  );

  const idWherePredicate =
    typeof _id !== 'undefined' ? `ID(${safeVariableName})=${_id}` : '';

  const nullFieldPredicates = Object.keys(nullParams).map(
    key => `${variableName}.${key} IS NULL`
  );

  const arrayPredicates = _.map(
    arrayParams,
    (value, key) => `${safeVariableName}.${safeVar(key)} IN $${key}`
  );

  const predicateClauses = [
    idWherePredicate,
    ...nullFieldPredicates,
    ...temporalClauses,
    ...arrayPredicates
  ]
    .filter(predicate => !!predicate)
    .join(' AND ');
  const predicate = predicateClauses ? `WHERE ${predicateClauses} ` : '';

  const query =
    `MATCH (${safeVariableName}:${safeLabelName} ${argString}) ${predicate}` +
    `RETURN ${safeVariableName} {${subQuery}} AS ${safeVariableName}${orderByValue} ${outerSkipLimit}`;

  return [query, params];
};

// Mutation API root operation branch
var translateMutation = ({
  resolveInfo,
  context,
  schemaType,
  selections,
  variableName,
  typeName,
  first,
  offset,
  otherParams
}) => {
  const outerSkipLimit = getOuterSkipLimit(first);
  const orderByValue = computeOrderBy(resolveInfo, selections);
  const mutationTypeCypherDirective = getMutationCypherDirective(resolveInfo);
  const params = initializeMutationParams({
    resolveInfo,
    mutationTypeCypherDirective,
    first,
    otherParams,
    offset
  });
  const mutationInfo = {
    params,
    selections,
    schemaType,
    resolveInfo
  };
  if (mutationTypeCypherDirective) {
    return customMutation({
      ...mutationInfo,
      context,
      mutationTypeCypherDirective,
      variableName,
      orderByValue,
      outerSkipLimit
    });
  } else if (isCreateMutation(resolveInfo)) {
    return nodeCreate({
      ...mutationInfo,
      variableName,
      typeName
    });
  } else if (isUpdateMutation(resolveInfo)) {
    return nodeUpdate({
      ...mutationInfo,
      variableName,
      typeName
    });
  } else if (isDeleteMutation(resolveInfo)) {
    return nodeDelete({
      ...mutationInfo,
      variableName,
      typeName
    });
  } else if (isAddMutation(resolveInfo)) {
    return relationshipCreate({
      ...mutationInfo
    });
  } else if (isRemoveMutation(resolveInfo)) {
    return relationshipDelete({
      ...mutationInfo,
      variableName
    });
  } else {
    // throw error - don't know how to handle this type of mutation
    throw new Error(
      'Do not know how to handle this type of mutation. Mutation does not follow naming convention.'
    );
  }
};

// Custom write operation
const customMutation = ({
  params,
  context,
  mutationTypeCypherDirective,
  selections,
  variableName,
  schemaType,
  resolveInfo,
  orderByValue,
  outerSkipLimit
}) => {
  const cypherParams = getCypherParams(context);
  const safeVariableName = safeVar(variableName);
  // FIXME: support IN for multiple values -> WHERE
  const argString = paramsToString(
    innerFilterParams(
      getFilterParams(params.params || params),
      null,
      null,
      true
    ),
    cypherParams
  );
  const cypherQueryArg = mutationTypeCypherDirective.arguments.find(x => {
    return x.name.value === 'statement';
  });
  const [subQuery, subParams] = buildCypherSelection({
    initial: '',
    selections,
    variableName,
    schemaType,
    resolveInfo,
    paramIndex: 1
  });
  const isScalarType = isGraphqlScalarType(schemaType);
  const temporalType = isTemporalType(schemaType.name);
  params = { ...params, ...subParams };
  if (cypherParams) {
    params['cypherParams'] = cypherParams;
  }
  const query = `CALL apoc.cypher.doIt("${
    cypherQueryArg.value.value
  }", ${argString}) YIELD value
    WITH apoc.map.values(value, [keys(value)[0]])[0] AS ${safeVariableName}
    RETURN ${safeVariableName} ${
    !temporalType && !isScalarType
      ? `{${subQuery}} AS ${safeVariableName}${orderByValue} ${outerSkipLimit}`
      : ''
  }`;
  return [query, params];
};

// Generated API
// Node Create - Update - Delete
const nodeCreate = ({
  variableName,
  typeName,
  selections,
  schemaType,
  resolveInfo,
  params
}) => {
  const safeVariableName = safeVar(variableName);
  const safeLabelName = safeLabel(typeName);
  let statements = [];
  const args = getMutationArguments(resolveInfo);
  statements = possiblySetFirstId({
    args,
    statements,
    params: params.params
  });
  const [preparedParams, paramStatements] = buildCypherParameters({
    args,
    statements,
    params,
    paramKey: 'params'
  });
  const [subQuery, subParams] = buildCypherSelection({
    initial: ``,
    selections,
    variableName,
    schemaType,
    resolveInfo,
    paramIndex: 1
  });
  params = { ...preparedParams, ...subParams };
  const query = `
    CREATE (${safeVariableName}:${safeLabelName} {${paramStatements.join(',')}})
    RETURN ${safeVariableName} {${subQuery}} AS ${safeVariableName}
  `;
  return [query, params];
};

const nodeUpdate = ({
  resolveInfo,
  variableName,
  typeName,
  selections,
  schemaType,
  params
}) => {
  const safeVariableName = safeVar(variableName);
  const safeLabelName = safeLabel(typeName);
  const args = getMutationArguments(resolveInfo);
  const primaryKeyArg = args[0];
  const primaryKeyArgName = primaryKeyArg.name.value;
  const temporalArgs = getTemporalArguments(args);
  const [primaryKeyParam, updateParams] = splitSelectionParameters(
    params,
    primaryKeyArgName,
    'params'
  );
  const temporalClauses = temporalPredicateClauses(
    primaryKeyParam,
    safeVariableName,
    temporalArgs,
    'params'
  );
  const predicateClauses = [...temporalClauses]
    .filter(predicate => !!predicate)
    .join(' AND ');
  const predicate = predicateClauses ? `WHERE ${predicateClauses} ` : '';
  let [preparedParams, paramUpdateStatements] = buildCypherParameters({
    args,
    params: updateParams,
    paramKey: 'params'
  });
  let query = `MATCH (${safeVariableName}:${safeLabelName}${
    predicate !== ''
      ? `) ${predicate} `
      : `{${primaryKeyArgName}: $params.${primaryKeyArgName}})`
  }
  `;
  if (paramUpdateStatements.length > 0) {
    query += `SET ${safeVariableName} += {${paramUpdateStatements.join(',')}} `;
  }
  const [subQuery, subParams] = buildCypherSelection({
    initial: ``,
    selections,
    variableName,
    schemaType,
    resolveInfo,
    paramIndex: 1
  });
  preparedParams.params[primaryKeyArgName] = primaryKeyParam[primaryKeyArgName];
  params = { ...preparedParams, ...subParams };
  query += `RETURN ${safeVariableName} {${subQuery}} AS ${safeVariableName}`;
  return [query, params];
};

const nodeDelete = ({
  resolveInfo,
  selections,
  variableName,
  typeName,
  schemaType,
  params
}) => {
  const safeVariableName = safeVar(variableName);
  const safeLabelName = safeLabel(typeName);
  const args = getMutationArguments(resolveInfo);
  const primaryKeyArg = args[0];
  const primaryKeyArgName = primaryKeyArg.name.value;
  const temporalArgs = getTemporalArguments(args);
  const [primaryKeyParam] = splitSelectionParameters(params, primaryKeyArgName);
  const temporalClauses = temporalPredicateClauses(
    primaryKeyParam,
    safeVariableName,
    temporalArgs
  );
  let [preparedParams] = buildCypherParameters({ args, params });
  let query = `MATCH (${safeVariableName}:${safeLabelName}${
    temporalClauses.length > 0
      ? `) WHERE ${temporalClauses.join(' AND ')}`
      : ` {${primaryKeyArgName}: $${primaryKeyArgName}})`
  }`;
  const [subQuery, subParams] = buildCypherSelection({
    initial: ``,
    selections,
    variableName,
    schemaType,
    resolveInfo,
    paramIndex: 1
  });
  params = { ...preparedParams, ...subParams };
  const deletionVariableName = safeVar(`${variableName}_toDelete`);
  // Cannot execute a map projection on a deleted node in Neo4j
  // so the projection is executed and aliased before the delete
  query += `
WITH ${safeVariableName} AS ${deletionVariableName}, ${safeVariableName} {${subQuery}} AS ${safeVariableName}
DETACH DELETE ${deletionVariableName}
RETURN ${safeVariableName}`;
  return [query, params];
};

// Relation Add / Remove
const relationshipCreate = ({
  resolveInfo,
  selections,
  schemaType,
  params
}) => {
  let mutationMeta, relationshipNameArg, fromTypeArg, toTypeArg;
  try {
    mutationMeta = resolveInfo.schema
      .getMutationType()
      .getFields()
      [resolveInfo.fieldName].astNode.directives.find(x => {
        return x.name.value === 'MutationMeta';
      });
  } catch (e) {
    throw new Error(
      'Missing required MutationMeta directive on add relationship directive'
    );
  }

  try {
    relationshipNameArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'relationship';
    });
    fromTypeArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'from';
    });
    toTypeArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'to';
    });
  } catch (e) {
    throw new Error(
      'Missing required argument in MutationMeta directive (relationship, from, or to)'
    );
  }

  //TODO: need to handle one-to-one and one-to-many
  const args = getMutationArguments(resolveInfo);
  const typeMap = resolveInfo.schema.getTypeMap();

  const fromType = fromTypeArg.value.value;
  const fromVar = `${lowFirstLetter(fromType)}_from`;
  const fromInputArg = args.find(e => e.name.value === 'from').type;
  const fromInputAst =
    typeMap[getNamedType(fromInputArg).type.name.value].astNode;
  const fromFields = fromInputAst.fields;
  const fromParam = fromFields[0].name.value;
  const fromTemporalArgs = getTemporalArguments(fromFields);

  const toType = toTypeArg.value.value;
  const toVar = `${lowFirstLetter(toType)}_to`;
  const toInputArg = args.find(e => e.name.value === 'to').type;
  const toInputAst = typeMap[getNamedType(toInputArg).type.name.value].astNode;
  const toFields = toInputAst.fields;
  const toParam = toFields[0].name.value;
  const toTemporalArgs = getTemporalArguments(toFields);

  const relationshipName = relationshipNameArg.value.value;
  const lowercased = relationshipName.toLowerCase();
  const dataInputArg = args.find(e => e.name.value === 'data');
  const dataInputAst = dataInputArg
    ? typeMap[getNamedType(dataInputArg.type).type.name.value].astNode
    : undefined;
  const dataFields = dataInputAst ? dataInputAst.fields : [];

  const [preparedParams, paramStatements] = buildCypherParameters({
    args: dataFields,
    params,
    paramKey: 'data'
  });
  const schemaTypeName = safeVar(schemaType);
  const fromVariable = safeVar(fromVar);
  const fromLabel = safeLabel(fromType);
  const toVariable = safeVar(toVar);
  const toLabel = safeLabel(toType);
  const relationshipVariable = safeVar(lowercased + '_relation');
  const relationshipLabel = safeLabel(relationshipName);
  const fromTemporalClauses = temporalPredicateClauses(
    preparedParams.from,
    fromVariable,
    fromTemporalArgs,
    'from'
  );
  const toTemporalClauses = temporalPredicateClauses(
    preparedParams.to,
    toVariable,
    toTemporalArgs,
    'to'
  );
  const [subQuery, subParams] = buildCypherSelection({
    initial: '',
    selections,
    schemaType,
    resolveInfo,
    paramIndex: 1,
    parentSelectionInfo: {
      rootType: 'relationship',
      from: fromVar,
      to: toVar,
      variableName: lowercased
    },
    variableName: schemaType.name === fromType ? `${toVar}` : `${fromVar}`
  });
  params = { ...preparedParams, ...subParams };
  let query = `
      MATCH (${fromVariable}:${fromLabel} ${
    fromTemporalClauses && fromTemporalClauses.length > 0
      ? // uses either a WHERE clause for managed type primary keys (temporal, etc.)
        `) WHERE ${fromTemporalClauses.join(' AND ')} `
      : // or a an internal matching clause for normal, scalar property primary keys
        // NOTE this will need to change if we at some point allow for multi field node selection
        `{${fromParam}: $from.${fromParam}})`
  }
      MATCH (${toVariable}:${toLabel} ${
    toTemporalClauses && toTemporalClauses.length > 0
      ? `) WHERE ${toTemporalClauses.join(' AND ')} `
      : `{${toParam}: $to.${toParam}})`
  }
      CREATE (${fromVariable})-[${relationshipVariable}:${relationshipLabel}${
    paramStatements.length > 0 ? ` {${paramStatements.join(',')}}` : ''
  }]->(${toVariable})
      RETURN ${relationshipVariable} { ${subQuery} } AS ${schemaTypeName};
    `;
  return [query, params];
};

const relationshipDelete = ({
  resolveInfo,
  selections,
  variableName,
  schemaType,
  params
}) => {
  let mutationMeta, relationshipNameArg, fromTypeArg, toTypeArg;
  try {
    mutationMeta = resolveInfo.schema
      .getMutationType()
      .getFields()
      [resolveInfo.fieldName].astNode.directives.find(x => {
        return x.name.value === 'MutationMeta';
      });
  } catch (e) {
    throw new Error(
      'Missing required MutationMeta directive on add relationship directive'
    );
  }

  try {
    relationshipNameArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'relationship';
    });
    fromTypeArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'from';
    });
    toTypeArg = mutationMeta.arguments.find(x => {
      return x.name.value === 'to';
    });
  } catch (e) {
    throw new Error(
      'Missing required argument in MutationMeta directive (relationship, from, or to)'
    );
  }

  //TODO: need to handle one-to-one and one-to-many
  const args = getMutationArguments(resolveInfo);
  const typeMap = resolveInfo.schema.getTypeMap();

  const fromType = fromTypeArg.value.value;
  const fromVar = `${lowFirstLetter(fromType)}_from`;
  const fromInputArg = args.find(e => e.name.value === 'from').type;
  const fromInputAst =
    typeMap[getNamedType(fromInputArg).type.name.value].astNode;
  const fromFields = fromInputAst.fields;
  const fromParam = fromFields[0].name.value;
  const fromTemporalArgs = getTemporalArguments(fromFields);

  const toType = toTypeArg.value.value;
  const toVar = `${lowFirstLetter(toType)}_to`;
  const toInputArg = args.find(e => e.name.value === 'to').type;
  const toInputAst = typeMap[getNamedType(toInputArg).type.name.value].astNode;
  const toFields = toInputAst.fields;
  const toParam = toFields[0].name.value;
  const toTemporalArgs = getTemporalArguments(toFields);

  const relationshipName = relationshipNameArg.value.value;

  const schemaTypeName = safeVar(schemaType);
  const fromVariable = safeVar(fromVar);
  const fromLabel = safeLabel(fromType);
  const toVariable = safeVar(toVar);
  const toLabel = safeLabel(toType);
  const relationshipVariable = safeVar(fromVar + toVar);
  const relationshipLabel = safeLabel(relationshipName);
  const fromRootVariable = safeVar('_' + fromVar);
  const toRootVariable = safeVar('_' + toVar);
  const fromTemporalClauses = temporalPredicateClauses(
    params.from,
    fromVariable,
    fromTemporalArgs,
    'from'
  );
  const toTemporalClauses = temporalPredicateClauses(
    params.to,
    toVariable,
    toTemporalArgs,
    'to'
  );
  // TODO cleaner semantics: remove use of _ prefixes in root variableNames and variableName
  const [subQuery, subParams] = buildCypherSelection({
    initial: '',
    selections,
    variableName,
    schemaType,
    resolveInfo,
    paramIndex: 1,
    parentSelectionInfo: {
      rootType: 'relationship',
      from: `_${fromVar}`,
      to: `_${toVar}`
    },
    variableName: schemaType.name === fromType ? `_${toVar}` : `_${fromVar}`
  });
  params = { ...params, ...subParams };
  let query = `
      MATCH (${fromVariable}:${fromLabel} ${
    fromTemporalClauses && fromTemporalClauses.length > 0
      ? // uses either a WHERE clause for managed type primary keys (temporal, etc.)
        `) WHERE ${fromTemporalClauses.join(' AND ')} `
      : // or a an internal matching clause for normal, scalar property primary keys
        `{${fromParam}: $from.${fromParam}})`
  }
      MATCH (${toVariable}:${toLabel} ${
    toTemporalClauses && toTemporalClauses.length > 0
      ? `) WHERE ${toTemporalClauses.join(' AND ')} `
      : `{${toParam}: $to.${toParam}})`
  }
      OPTIONAL MATCH (${fromVariable})-[${relationshipVariable}:${relationshipLabel}]->(${toVariable})
      DELETE ${relationshipVariable}
      WITH COUNT(*) AS scope, ${fromVariable} AS ${fromRootVariable}, ${toVariable} AS ${toRootVariable}
      RETURN {${subQuery}} AS ${schemaTypeName};
    `;
  return [query, params];
};

module.exports = {
  translateQuery,
  translateMutation
};
