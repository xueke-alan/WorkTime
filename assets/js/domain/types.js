"use strict";
/**
 * Runtime data contracts. Minutes are the internal unit; missing and null do not mean zero.
 * OA raw fields store compact date/weekday/punch/status evidence, not full page text.
 * @typedef {{id:string,title:string,date:string,endDate?:string,allDay:boolean,start:string,end:string,note:string,completed:boolean,createdAt:string,updatedAt:string}} WorkAgendaItem
 * @typedef {{start:number,end:number}} WorkBreak
 * @typedef {{configured:boolean,workStart:string,workEnd:string,standardMinutes:number,breaks:WorkBreak[]}} WorkSettings
 * @typedef {{employmentDate:string,workCity:string}} WorkPersonal
 * @typedef {{pageTheme:'green'|'blue'|'purple'|'orange'|'rose'|'slate'|'cyan'|'mint'|'olive'|'gold'|'red'|'brown',forecastMode?:'hourly'|'daily',language?:'auto'|'zh-CN'|'zh-TW'|'zh-HK'|'en'|'ko'|'ja',weatherDays?:0|3|5|7}} WorkPreferences
 * @typedef {{id:string,order?:number,data:Object}} ArchiveRecord
 * @typedef {{id:string,version:number,records:ArchiveRecord[]}} ArchiveModule
 * @typedef {{format:'worktime-archive',formatVersion:1,archive:{id:string,createdAt:string},modules:ArchiveModule[],exportedAt?:string}} WorkArchive
 * @typedef {{load:function():Promise<Object>,commit:function(Object,Object):Promise<WorkOperationResult>,restore:function(Object):Promise<WorkOperationResult>,export:function(Object):Promise<WorkArchive>}} WorkPersistence
 * @typedef {{start:string,end:string,nextDay:boolean,effectiveMinutes:number|null}} WorkManualRecord
 * @typedef {{start:string,end:string,nextDay:boolean,effectiveMinutes?:never}} WorkDraft
 * @typedef {{start:string,end:string,nextDay:boolean,effectiveMinutes?:number|null,type:string,manual:boolean,filledStart?:boolean,filledEnd?:boolean}} WorkEffectiveRecord
 * @typedef {{date:string,start:string,end:string,nextDay:boolean,status:'complete'|'pending'|'off',source:string,raw:string,importId?:string}} WorkOAObservation
 * @typedef {{sourcePriority?:'oa'|'manual',oa?:WorkOAObservation,actual?:WorkManualRecord,estimate?:WorkManualRecord,draft?:WorkDraft,kind?:'work'|'rest',leaveMinutes?:number,note?:string,plannedOvertime?:boolean}} WorkDay
 * @typedef {{name:string,raw:string}} WorkImportSource
 * @typedef {{id:string,at:string,year:number,sources:WorkImportSource[],count:number,records:WorkOAObservation[],_lazy?:boolean}} WorkImportLog
 * @typedef {'ADDED'|'DUPLICATE'|'KEEP_COMPLETE'|'COMPLETE_CONFLICT'|'COMPLETED'|'KEEP_START'|'UPDATED'} WorkImportMergeCode
 * @typedef {{record:WorkOAObservation,code:WorkImportMergeCode,conflict?:boolean}} WorkObservationMerge
 * @typedef {{id:string,name:string,start:string,end:string,nextDay:boolean}} WorkTimeTemplate
 * @typedef {{workStart:string,workEnd:string,standardMinutes:number,breaks:WorkBreak[]}} WorkScheduleData
 * @typedef {{start:string,end:string|null,schedule:WorkScheduleData}} WorkScheduleRange
 * @typedef {{memo?:string,agenda?:WorkAgendaItem[],scheduleRanges:WorkScheduleRange[],schemaVersion:3,personal:WorkPersonal,preferences:WorkPreferences,overtimeRequirements:(number|null)[],oaUrl:string,settings:WorkSettings,timeTemplates:WorkTimeTemplate[],days:Object<string,WorkDay>,imports:WorkImportLog[],_archive?:{recordExtras?:Object,dataExtras?:Object}}} WorkStateData
 * @typedef {{reset:'none'|'selected'|'all',month:string,dates:string[],record:WorkManualRecord|null,valid:boolean,canConfirm:boolean}} WorkBatchDraft
 * @typedef {{base:WorkStateData,state:WorkStateData}} WorkBatchPreview
 * @typedef {{today:string,month:string,selected:string,batchMode:boolean,batchDays:Set<string>,batchDraft:WorkBatchDraft|null,batchSaving:boolean,yearMode:boolean,viewYear:number,analysisMode:boolean,analysisIncludeManual:boolean,agendaViewWeeks?:0|1|2,agendaViewAnchor?:string}} WorkViewState
 * @typedef {'unavailable'|'unsupported'|'corrupt'|null} WorkStorageLoadIssue
 * @typedef {WorkViewState & {state:WorkStateData,revision:number,storageFailed:boolean,loadCorrupt:boolean,loadIssue:WorkStorageLoadIssue,batchAnchor:string|null,batchPreview:WorkBatchPreview|null,returnMonth:string}} WorkApplicationModel
 * @typedef {{core:Object,element:function(string):HTMLElement,escape:function(*):string,getState:function():WorkStateData,getView:function():WorkViewState,document:Document,window:Window}} WorkViewDependencies
 * @typedef {{changed:boolean,applied:boolean,persisted:boolean,dirty:boolean,code:string|null,message:string,error:Error|null}} WorkOperationResult
 * @typedef {Error & {code?:string}} WorkStorageError
 * @typedef {{persisted:boolean,error?:WorkStorageError|null}} WorkWriteResult
 * @typedef {{loadIssue:WorkStorageLoadIssue,commit:(state:WorkStateData,changes:Object)=>Promise<WorkWriteResult>,restore:(state:WorkStateData)=>Promise<WorkWriteResult>,hydrateImports:(state:WorkStateData)=>Promise<WorkStateData>,export:(state:WorkStateData)=>Promise<WorkArchive>}} WorkStatePersistence
 * @typedef {{defaultState:typeof WorkTimeApp.domain.state.defaultState,calendarInfo:typeof WorkTimeApp.domain.calendar.calendarInfo,validateTimeTemplate:typeof WorkTimeApp.domain.validation.validateTimeTemplate,applyObservation:typeof WorkTimeApp.domain.observations.applyObservation,compactOAState:typeof WorkTimeApp.domain.observations.compactOAState,deleteImport:typeof WorkTimeApp.domain.observations.deleteImport}} WorkApplicationCore
 * @typedef {Pick<typeof WorkTimeDomainStatistics,'summary'|'countRestOvertimeDays'|'selectOvertimeRequirement'|'targetPace'|'pendingWorkdays'|'oaStaleness'|'attendanceHoursThrough'|'cumulativeAverageOvertime'> & Pick<typeof WorkTimeDomainTime,'validDate'|'businessDate'|'businessMinutes'|'timeMin'|'localDate'|'dateKey'> & Pick<typeof WorkTimeDomainRecords,'calculate'> & Pick<typeof WorkTimeDomainSchedule,'scheduleForDate'> & Pick<typeof WorkTimeDomainState,'DEFAULT_START'>} WorkDerivedCore
 * @typedef {{agenda:{validate:(item:any)=>WorkAgendaItem,validateItems:(items:any)=>WorkAgendaItem[],forDate:(items:WorkAgendaItem[],date:string)=>WorkAgendaItem[],lastDate:(item:WorkAgendaItem)=>string,overlaps:(item:WorkAgendaItem,first:string,last:string)=>boolean,segments:(items:WorkAgendaItem[],dates:string[])=>any[],move:(item:WorkAgendaItem,days:number)=>WorkAgendaItem},batch:typeof WorkTimeDomainBatch,calendar:typeof WorkTimeDomainCalendar,observations:typeof WorkTimeDomainObservations,preferences:typeof WorkTimeDomainPreferences,records:typeof WorkTimeDomainRecords,schedule:typeof WorkTimeDomainSchedule,state:typeof WorkTimeDomainState,statistics:typeof WorkTimeDomainStatistics,time:typeof WorkTimeDomainTime,validation:typeof WorkTimeDomainValidation}} WorkDomainNamespace
 * @typedef {{application:typeof WorkTimeServiceApplication,derived:typeof WorkTimeServiceDerived,clock:typeof WorkTimeServiceClock,[key:string]:any}} WorkServiceNamespace
 * @typedef {{domain:WorkDomainNamespace,services:WorkServiceNamespace,ui:Object,data:{dateInfo:Object,[key:string]:any}}} WorkTimeNamespace
 *
 * OA status 'off' is an observation with no punches, not an implicit personal leave.
 * sourcePriority defaults to OA, filling missing clocks from manual; manual priority uses manual alone.
 * draft supersedes older manual data, including empty fields; estimate may apply to past dates.
 * Only manual records accept non-null effectiveMinutes; 0 is a valid correction.
 * Every import contains explicit accepted records; [] means no accepted records. Raw text is never replayed by the runtime.
 * Schema 3 is only the internal calculation projection. Persisted data uses WorkArchive.
 * Internal _archive retains extension metadata; _lazy import details must hydrate before replay/export.
 * overtimeRequirements contains five tiers in minutes; null means not configured.
 * UI accepts tenths of an hour; backup requirements retain finite precision without rounding.
 */
