import Job from "../job.js";
import JobOccurrence from "../jobOccurrence.js";
import JobProgram from "../jobProgram.js";
import {Message, MsgArrayStore} from "ui-message";
import {msgArray} from "../../data/message_job_server.js";
import CronParser from "cron-parser";
import {OccurrenceStatusEnum, StartConditionEnum} from "../constants.js";

const msgStore = new MsgArrayStore(msgArray);
export const message = new Message(msgStore, 'EN');

export default class JobCtrl{
  static createJob(req, res) {
    try {
      const job = new Job(req.body);
      if (process.env.USE_DB === 'true') {
        job.createJobDB()
          .then(r => res.json([message.report('job', 'JOB_IS_SAVED', 'S', req.body.name)]))
          .catch(errors => res.json(errors));
      } else {
        res.json([message.report('job', 'JOB_IS_SAVED', 'S', req.body.name)]);
      }
    } catch (e) {
      res.json([e.message]);
    }
  }

  static changeJob(req, res) {
    Job.changeJob(req.body)
      .then( r => res.json([message.report('job', 'JOB_IS_SAVED', 'S', r.name)]))
      .catch( e => {
        if (Array.isArray(e)) {
          res.json(e)
        } else {
          res.json([e.message])
        }
      });
  }

  static scheduleJobs(req, res) {
    const jobNames = req.body;
    let iterator = jobNames.map( jobName => {
      return Job.getJob(jobName).instance.scheduleOccurrences();
    });
    Promise.all(iterator)
      .then((results)=>{
        res.json(results.map(result => message.report('job', 'JOB_IS_SCHEDULED', 'S', result.jobName)))
      })
      .catch(e => {
        if (Array.isArray(e)){
          res.json(e)
        } else {
          res.json([e.message])
        }
      });
  }

  static simulateRecurrences(req, res) {
    const cronString = req.body.cronString;
    const cronOption = {
      currentDate: req.body.cronCurrentDate? new Date(req.body.cronCurrentDate + ' UTC') : null,
      endDate: req.body.cronEndDate? new Date(req.body.cronEndDate + ' UTC'): null,
      tz: req.body.tz
    };
    const occurrences = [];
    const maxShown = 50;
    try {
      const interval = CronParser.parseExpression(cronString, cronOption);
      let scheduleDateTime;
      while (true) {
        try {
          scheduleDateTime = interval.next().toISOString().slice(0, 19).replace('T', ' ');
          if (occurrences.length > maxShown) {
            break;
          } else {
            occurrences.push(scheduleDateTime);
          }
        } catch (e) {
          break;
        }
      }
      res.json(occurrences);
    } catch (err) {
      res.json(message.report('job', 'GENERIC_ERROR', 'E', err));
    }
  }

  static getJob(req, res) {
    let jobEntry = Job.getJob(req.params['name']);
    if (!jobEntry) { // Doesn't hit the cache, try to find it in DB
      if (process.env.USE_DB === 'true') {
        Job.getJobDB(req.params['name'])
          .then(result => res.json(result))
          .catch(errors =>{
            if (errors[0].msgName === 'INSTANCE_NOT_IDENTIFIED') {
              res.json(message.report('job', 'JOB_NOT_EXIST', 'E', req.params['name']));
            } else {
              res.json(errors);
            }
          });
      } else {
        res.json(message.report('job', 'JOB_NOT_EXIST', 'E', req.params['name']));
      }
    } else {
      // Construct a new JSON to avoid expose instance
      res.json({
        name: jobEntry.name,
        status: jobEntry.status,
        mode: jobEntry.startCondition.mode,
        description: jobEntry.description,
        identity: jobEntry.identity,
        steps: jobEntry.steps,
        startCondition: jobEntry.startCondition,
        outputSetting: jobEntry.outputSetting,
        finishedOccurrences: jobEntry.finishedOccurrences,
        failedOccurrences: jobEntry.failedOccurrences,
        canceledOccurrences: jobEntry.canceledOccurrences,
        createdBy: jobEntry.createdBy,
        createTime: jobEntry.createTime,
        lastChangedBy: jobEntry.lastChangedBy,
        lastChangeTime: jobEntry.lastChangeTime
      });
    }
  }

  static getJobStatus(req, res) {
    const jobEntry = Job.getJob(req.params['name']);
    if (jobEntry) {
      res.json(jobEntry.status);
    } else {
      res.json(null);
    }
  }

  static searchJobs(req, res) {
    let filter = {};
    if (req.query.name_includes) {
      filter.name_includes = req.query.name_includes;
    }
    if (req.query.status) {
      filter.status = [];
      let statusS = Array.isArray(req.query.status)? req.query.status : [req.query.status];
      statusS.forEach( s => filter.status.push(parseInt(s, 10)));
    }
    if (req.query.mode) {
      filter.mode = [];
      let modes = Array.isArray(req.query.mode)? req.query.mode : [req.query.mode];
      modes.forEach( m => filter.mode.push(parseInt(m, 10)));
    }
    if (req.query.program) {
      filter.program = req.query.program;
    }
    filter = Object.keys(filter).length === 0? null : filter;
    if (process.env.USE_DB === 'true') {
      Job.getJobsDB(filter)
        .then( result => res.json(result))
        .catch( errors => res.json(errors))
    } else {
      const jobs = Job.getJobs(filter);
      res.json(jobs.map( job => {
        return {
          name: job.name,
          description: job.description,
          status: job.status,
          mode: job.startCondition.mode,
          identity: job.identity,
          steps: job.steps,
          startCondition: job.startCondition,
          outputSetting: job.outputSetting,
          finishedOccurrences: job.finishedOccurrences,
          failedOccurrences: job.failedOccurrences,
          canceledOccurrences: job.canceledOccurrences,
          createdBy: job.createdBy,
          createTime: job.createTime,
          lastChangedBy: job.lastChangedBy,
          lastChangeTime: job.lastChangeTime,
        }
      }));
    }
  }

  static cancelJobs(req, res) {
    const jobNames = req.body;
    let iterator = jobNames.map( async (jobName) => {
      await Job.getJob(jobName).instance.cancel();
      return jobName;
    });
    Promise.all(iterator)
      .then((jobNames)=>{
        res.json(jobNames.map(j => message.report('job', 'JOB_IS_CANCELED', 'S', j)))
      })
      .catch(e => {
        if (Array.isArray(e)){
          res.json(e)
        } else {
          res.json([e.message])
        }
      });
  }

  static searchJobOccurrences(req, res) {
    const jobName = req.params['name'];
    const filter = {jobName: jobName};
    if (req.query.status) {
      filter.status = [];
      let statuses = Array.isArray(req.query.status)? req.query.status : [req.query.status];
      statuses.forEach( s => filter.status.push(parseInt(s, 10)));
    }
    if (req.query.startDate) {
      filter.startDate = req.query.startDate;
    }
    if (req.query.endDate) {
      filter.endDate = req.query.endDate;
    }

    let occurrences = [];
    if (process.env.USE_DB === 'true') {
      JobOccurrence.getOccurrencesDB(filter)
        .then( result => {
          occurrences = result;
          if (!filter.status || filter.status.includes(OccurrenceStatusEnum.initial)) {
            _getUnscheduledOccurrences();
          }
          res.json(occurrences);
        })
        .catch( errors => res.json(errors))
    } else {
      occurrences = JobOccurrence.getOccurrences(filter).map(occurrence => {
        return {
          uuid: occurrence.uuid,
          jobName: occurrence.jobName,
          status: occurrence.status,
          actualStartDateTime: occurrence.actualStartDateTime,
          endDateTime: occurrence.endDateTime,
          scheduledDateTime: occurrence.scheduledDateTime
        }
      });
      if (filter.status.includes(OccurrenceStatusEnum.initial)) {
        _getUnscheduledOccurrences();
      }
      res.json(occurrences);
    }

    function _getUnscheduledOccurrences() {
      const job = Job.getJob(jobName)?.instance;
      if (!job || job.startCondition.mode === StartConditionEnum.immediately) {return;}
      try {
        const unScheduledOccurrences = job.getUnscheduledOccurrences(filter.endDate || null)
          .map((scheduleDateTime, index) => {
            return {
              uuid: index,
              jobName: jobName,
              status: OccurrenceStatusEnum.initial,
              actualStartDateTime: '',
              endDateTime: '',
              scheduledDateTime: scheduleDateTime
            }
          });
        Array.prototype.push.apply(occurrences, unScheduledOccurrences);
      } catch (e) {
        console.error(e);
      }
    }
  }

  static getOccurrence(req, res) {
    let uuid = req.params['uuid'];
    const occurrence = JobOccurrence.getOccurrence(uuid);
    if (occurrence) {
      res.json({
        uuid: occurrence.uuid,
        status: occurrence.status,
        jobName: occurrence.jobName,
        scheduledDateTime: occurrence.scheduledDateTime,
        actualStartDateTime: occurrence.actualStartDateTime,
        endDateTime: occurrence.endDateTime,
        identity: occurrence.identity,
        steps: occurrence.steps,
        startCondition: occurrence.startCondition,
        outputSetting: occurrence.outputSetting,
        applicationLog: occurrence.applicationLog
      });
    } else {
      if (process.env.USE_DB === 'true') {
        JobOccurrence.getOccurrenceDB(uuid)
          .then( result => res.json(result))
          .catch( errors => res.json(errors))
      } else {
        res.json(null);
      }
    }
  }

  static cancelOccurrences(req, res) {
    const occurrenceUUIDs = req.body;
    let iterator = occurrenceUUIDs.map( async (uuid) => {
        let occurrence = JobOccurrence.getOccurrence(uuid);
        await occurrence.instance.cancel();
        return occurrence;
    });
    Promise.all(iterator)
      .then((occurrence)=>{
        res.json(occurrence.map(o => message.report('job', 'OCCURRENCE_IS_CANCELED', 'S', o.uuid, o.jobName)))
      })
      .catch(e => {
        if (Array.isArray(e)){
          res.json(e)
        } else {
          res.json([e.message])
        }
      });
  }

  static searchJobPrograms(req, res) {
    res.json(JobProgram.getJobPrograms(req.query.nameFilter));
  }

  static getJobProgramDefinition(req, res) {
    res.json(JobProgram.getJobProgramDefinition(req.params['name']));
  }
}
